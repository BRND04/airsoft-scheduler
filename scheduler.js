// --- 1. SET UP SUPABASE ---
const SUPABASE_URL = 'https://foqlzzkmuorokqsqjtbk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvcWx6emttdW9yb2txc3FqdGJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU2MzUwNjksImV4cCI6MjA3MTIxMTA2OX0.einCfTr3Cta51n3fOOET4Hz6p0KtRHy5NAoDTCgIbBg';
const supaClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- 2. GRAB HTML ELEMENTS ---
const gamesList = document.getElementById('games-list');
const addGameForm = document.getElementById('add-game-form');
const editModal = document.getElementById('edit-modal');
const editGameForm = document.getElementById('edit-game-form');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const reasonModal = document.getElementById('reason-modal');
const reasonForm = document.getElementById('reason-form');
const cancelReasonBtn = document.getElementById('cancel-reason-btn');
const formHeader = addGameForm.querySelector('.form-header');
let currentUser = null;

window._pulseTest = true; // force ETA pulse for testing


// --- 3. ROUTING VARIABLES ---
let locationInterval = null; 
const AREA_66_COORDS = [55.6080, -4.5055];
const GRANT_COORDS = [55.58763831240875, -4.489699872812489];
const LUC_COORDS = [55.5954546248295, -4.444951898993158];
const legStatusByGame = {};
const proximityFlags = {}; // { [gameId]: { [username]: { grant:{twoMi,arrived}, luc:{...}, site:{...} } } }


// --- 4. AUTHENTICATION & INITIAL LOAD ---
supaClient.auth.onAuthStateChange((event, session) => {
    if (!session && !window.location.hash.includes('access_token')) {
        window.location.href = 'index.html';
    } else if (session) {
        currentUser = session.user;
        document.getElementById('user-display').textContent = `Signed in as: ${currentUser.user_metadata.username}`;
        fetchGames(); // Fetch everything once on load
        setInterval(updateAllAvailabilities, 10000); // Poll for availability changes
    }
});

// --- 5. COLLAPSIBLE FORM LOGIC ---
const collapseBtn = document.getElementById('collapse-form-btn');
const chevronIcon = collapseBtn.querySelector('i');

/** Keep header + chevron in sync */
function setFormCollapsed(collapsed) {
  addGameForm.classList.toggle('collapsed', collapsed);
  chevronIcon.classList.toggle('fa-chevron-down', collapsed);
  chevronIcon.classList.toggle('fa-chevron-up', !collapsed);
  collapseBtn.setAttribute('aria-expanded', String(!collapsed));
}

// collapsed by default on page load
setFormCollapsed(true);

// click the chevron
collapseBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation(); // don't bubble to form
  setFormCollapsed(!addGameForm.classList.contains('collapsed'));
});

// click the title text
const headerTitle = formHeader.querySelector('h2');
headerTitle.addEventListener('click', () => {
  setFormCollapsed(!addGameForm.classList.contains('collapsed'));
});



// --- 6. REALTIME LOCATION LISTENER ---
const listenForLocations = (gameId) => {
  const channel = supaClient.channel(`game-${gameId}`);
  channel
    .on('broadcast', { event: 'location_update' }, (payload) => {
      const { username, lat, lng, status } = payload.payload;

      // Only react to OTHER users
      if (username !== currentUser.user_metadata.username) {
        // keep your existing routing update
        getRoute(gameId, { lat, lng }, status);

        // --- PROXIMITY ALERTS (in-app) ---
        const targetInfo = (() => {
          if (status === 'initial') {
            return { key: 'grant', label: "Grant's", lat: GRANT_COORDS[0], lng: GRANT_COORDS[1] };
          }
          if (status === 'picked_up_grant') {
            return { key: 'luc', label: "Luc's", lat: LUC_COORDS[0], lng: LUC_COORDS[1] };
          }
          if (status === 'picked_up_luc') {
            return { key: 'site', label: 'Area 66', lat: AREA_66_COORDS[0], lng: AREA_66_COORDS[1] };
          }
          return null;
        })();

        if (targetInfo) {
          const dist = haversineMiles({ lat, lng }, { lat: targetInfo.lat, lng: targetInfo.lng });

          // init per-game/per-user flags
          proximityFlags[gameId] ??= {};
          proximityFlags[gameId][username] ??= {
            grant: { twoMi: false, arrived: false },
            luc:   { twoMi: false, arrived: false },
            site:  { twoMi: false, arrived: false }
          };
          const flags = proximityFlags[gameId][username][targetInfo.key];

          // ~2 miles heads-up
          if (!flags.twoMi && dist <= 2.0) {
            flags.twoMi = true;
            showToast(`${username} is ~${dist.toFixed(1)} mi from ${targetInfo.label}`);
            if (navigator.vibrate) navigator.vibrate(150);
          }

          // "I'm outside" (~0.1 mi ≈ 160m)
          if (!flags.arrived && dist <= 0.1) {
            flags.arrived = true;
            showToast(`${username} is outside ${targetInfo.label}`);
            if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
          }
        }
        // --- /PROXIMITY ALERTS ---
      }
    })
    .subscribe();
};

// --- 7. FETCH & DISPLAY GAMES (RUNS ONCE) ---
const fetchGames = async () => {
    const { data: games, error } = await supaClient.from('games').select('*').order('date', { ascending: true });
    if (error) { console.error('Error fetching games:', error); return; }

    gamesList.innerHTML = '';
    if (games.length === 0) {
        gamesList.innerHTML = '<h3>No upcoming games scheduled.</h3>';
        return;
    }

    games.forEach(game => {
        const newCard = createGameCard(game);
        gamesList.appendChild(newCard);
        listenForLocations(game.id);
    });
};

// --- NEW: LIGHTWEIGHT POLLING FUNCTION ---
const updateAllAvailabilities = async () => {
    const { data: games, error } = await supaClient.from('games').select('id, availability');
    if (error) { console.error('Error polling for availability:', error); return; }

    games.forEach(game => {
        const cardElement = document.getElementById(`game-${game.id}`);
        if (cardElement) {
            updateGameCard(cardElement, game);
        }
    });
};

// Abort fetches that hang (public OSRM can be slow)
async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Which stop are we routing to for a given leg?
function nextTargetForStatus(status) {
  if (status === 'initial')        return { label: "Grant's", lat: GRANT_COORDS[0], lng: GRANT_COORDS[1] };
  if (status === 'picked_up_grant') return { label: "Luc's",   lat: LUC_COORDS[0],   lng: LUC_COORDS[1]   };
  if (status === 'picked_up_luc')   return { label: 'Area 66', lat: AREA_66_COORDS[0], lng: AREA_66_COORDS[1] };
  return null;
}

// Put this helper near updateRouteInfo
function showEtaUnavailable(gameId, status) {
  const etaEl = document.getElementById(`eta-${gameId}`);
  if (!etaEl) return;

  let dest = '';
  if (status === 'initial') dest = "Grant's";
  else if (status === 'picked_up_grant') dest = "Luc's";
  else if (status === 'picked_up_luc') dest = "Area 66";

  etaEl.innerHTML = `ETA to ${dest}: <strong class="eta-error">Unavailable (cannot fetch)</strong>`;
}



// --- 8. ROUTING FUNCTIONS (USING OSRM) ---
const getRoute = async (gameId, startCoords, status) => {
  let waypoints = `${startCoords.lng},${startCoords.lat}`;
  if (status === 'initial') {
    waypoints += `;${GRANT_COORDS[1]},${GRANT_COORDS[0]};${LUC_COORDS[1]},${LUC_COORDS[0]};${AREA_66_COORDS[1]},${AREA_66_COORDS[0]}`;
  } else if (status === 'picked_up_grant') {
    waypoints += `;${LUC_COORDS[1]},${LUC_COORDS[0]};${AREA_66_COORDS[1]},${AREA_66_COORDS[0]}`;
  } else if (status === 'picked_up_luc') {
    waypoints += `;${AREA_66_COORDS[1]},${AREA_66_COORDS[0]}`;
  } else {
    updateRouteInfo(gameId, 0, 0, 'finished');
    return;
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${waypoints}?overview=false`;

  try {
    const resp = await fetch(url /*, { signal: AbortSignal.timeout(8000) } */);
    if (!resp.ok) throw new Error(`OSRM ${resp.status}`);
    const data = await resp.json();

    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const nextLeg = data.routes[0].legs[0];
      updateRouteInfo(gameId, nextLeg.duration, nextLeg.distance, status);
    } else {
      showEtaUnavailable(gameId, status);
    }
  } catch (err) {
    console.warn('Directions fetch failed:', err);
    showEtaUnavailable(gameId, status);
  }
};

const updateRouteInfo = (gameId, duration, distance, status, estimated = false) => {
  const etaElement = document.getElementById(`eta-${gameId}`);
  if (!etaElement) return;

  if (status === 'finished') {
    etaElement.innerHTML = `<strong>Journey Complete!</strong>`;
    return;
  }

  const minutes = Math.round(duration / 60);
  const miles   = (distance / 1609.344).toFixed(1);
  const color   = etaColor ? etaColor(minutes, 40) : '#f6a319';

  let destination = '';
  if (status === 'initial') destination = "Grant's";
  else if (status === 'picked_up_grant') destination = "Luc's";
  else if (status === 'picked_up_luc') destination = "Area 66";

  etaElement.innerHTML = `
    ETA to ${destination}:
    <strong>
      <span class="eta-mins" style="color:${color}">${minutes} mins</span>
    </strong>
    (<span class="eta-dist">${miles} mi</span>)${estimated ? ' <small class="eta-note">(est.)</small>' : ''}
  `;

  const minsEl = etaElement.querySelector('.eta-mins');
  const shouldFlash = (window._flashTest === true) || minutes <= 3;
  if (minsEl) {
    if (shouldFlash) minsEl.classList.add('eta-flash');
    else minsEl.classList.remove('eta-flash');
  }
};


// --- 9. RENDER/UPDATE CARD FUNCTIONS ---
const createGameCard = (game) => {
  const cardElement = document.createElement('div');
  cardElement.className = 'game-card';
  cardElement.id = `game-${game.id}`;
  // driver = creator only if they checked the box
  cardElement.dataset.driverId = game.user_id;                 // who CAN be driver
  cardElement.dataset.isDriver = String(!!game.is_driver);     // did they choose to be driver
  cardElement.innerHTML = generateCardContent(game);
  return cardElement;
};

const updateGameCard = (cardElement, game) => {
    // This function now only updates the availability section
    updateAvailabilitySection(cardElement, game.availability);
};

// --- Availability HTML (hoisted) ---
function generateAvailabilityContent(availability, gameId) {
  const username = currentUser.user_metadata.username;
  const safe = availability || { going: [], maybe: [], cant_make_it: [] };
  const currentUserGoing = safe.going.find(p => p.name === username);

  const renderGoingAttendeeList = (attendees) => {
    if (!attendees || attendees.length === 0) return '<li>None yet</li>';
    return attendees
      .map(person => `<li>${person.name} ${person.booked ? '<i class="fas fa-ticket-alt booking-icon" title="Booked!"></i>' : ''}</li>`)
      .join('');
  };

  const renderReasonAttendeeList = (attendees) => {
    if (!attendees || attendees.length === 0) return '<li>None yet</li>';
    return attendees
      .map(person => `<li data-tooltip="${person.reason || 'No reason given'}">${person.name}</li>`)
      .join('');
  };

  return `
    <div class="availability-controls">
      <button class="availability-btn going ${currentUserGoing ? 'selected' : ''}"
              data-id="${gameId}" data-status="going">Going</button>
      <button class="availability-btn maybe ${safe.maybe.includes(username) ? 'selected' : ''}"
              data-id="${gameId}" data-status="maybe">Maybe</button>
      <button class="availability-btn cant-make-it ${safe.cant_make_it.some(p => p.name === username) ? 'selected' : ''}"
              data-id="${gameId}" data-status="cant_make_it">Can't Go</button>
    </div>
    <div class="availability-display">
      <div class="status-column going">
        <h4>✅ Going (${safe.going.length})</h4>
        <ul class="attendee-list">${renderGoingAttendeeList(safe.going)}</ul>
      </div>
      <div class="status-column maybe">
        <h4>🤔 Maybe (${safe.maybe.length})</h4>
        <ul class="attendee-list">${safe.maybe.map(name => `<li>${name}</li>`).join('') || '<li>None yet</li>'}</ul>
      </div>
      <div class="status-column cant-make-it">
        <h4>❌ Can't Go (${safe.cant_make_it.length})</h4>
        <ul class="attendee-list">${renderReasonAttendeeList(safe.cant_make_it)}</ul>
      </div>
    </div>
  `;
}

const generateCardContent = (game) => {
  const availability = game.availability || { going: [], maybe: [], cant_make_it: [] };
  const username = currentUser.user_metadata.username;
  const currentUserGoing = availability.going.find(p => p.name === username);
  const isToday = new Date(game.date).toDateString() === new Date().toDateString();

  const calculateCountdown = (gameDateStr) => {
    const gameDate = new Date(gameDateStr).getTime();
    const now = new Date().getTime();
    const distance = gameDate - now;
    if (distance < 0) return "It's Game Day!";
    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `<span>${days}d</span> <span>${hours}h</span>`;
  };

  const adminControls = game.user_id === currentUser.id ? `
    <div class="game-card-actions">
      <button class="icon-button edit-btn" data-id="${game.id}" title="Edit Game"><i class="fas fa-pencil-alt"></i></button>
      <button class="icon-button delete-btn" data-id="${game.id}" title="Delete Game"><i class="fas fa-trash-alt"></i></button>
    </div>
  ` : '';

  const notesSection = game.description ? `<div class="game-notes"><h4 class="card-section-heading">Notes:</h4><p>${game.description}</p></div>` : '';
  const countdownSection = `<div class="countdown-wrapper"><h4 class="card-section-heading">Countdown:</h4><div class="game-countdown">${calculateCountdown(game.date)}</div></div>`;
  const bookingSection = (currentUserGoing && !currentUserGoing.booked) ? `
    <div class="booking-confirmation"><h4 class="card-section-heading">Have you booked yet?</h4>
      <div class="booking-buttons">
        <button class="booking-btn yes-btn" data-id="${game.id}">Yes</button>
        <a href="https://area-66.co.uk/shop" target="_blank" class="booking-btn no-btn">No</a>
      </div>
    </div>` : '';

  // Driver is: (1) creator of the game AND (2) checked "is_driver"
  const iAmDriver = (game.user_id === currentUser.id) && !!game.is_driver;

  const locationSharingSection = (isToday && currentUserGoing) ? `
    <div class="location-sharing-section">
      <h4 class="card-section-heading">Ride Tracker</h4>
      <div id="eta-${game.id}" class="eta-display">Awaiting location...</div>
      ${iAmDriver ? `
        <div class="location-controls">
          <button class="location-btn start-sharing" data-id="${game.id}"><i class="fas fa-satellite-dish"></i> Start Sharing</button>
          <button class="location-btn stop-sharing" data-id="${game.id}" style="display:none;"><i class="fas fa-ban"></i> Stop Sharing</button>
          <button class="location-btn pickup" data-id="${game.id}" data-status="picked_up_grant" style="display:none;">Picked up Grant</button>
          <button class="location-btn pickup" data-id="${game.id}" data-status="picked_up_luc" style="display:none;">Picked up Luc</button>
        </div>
      ` : `
        <div class="tracker-note">Only the driver can share location. You’ll see the ETA here once they start.</div>
      `}
    </div>
  ` : '';

  return `
    <div class="game-card-header">
      <div><h3>${game.location}</h3><p><strong>Date:</strong> ${new Date(game.date).toLocaleDateString()}</p></div>
    </div>
    ${adminControls}
    ${countdownSection}
    ${notesSection}
    ${bookingSection}
    ${locationSharingSection}
    <div class="availability-section">
      ${generateAvailabilityContent(availability, game.id)}
    </div>
  `;
};

// --- util: make sure the referenced game exists (avoids FK 23503) ---
async function ensureGameExists(gameId) {
  const { data, error } = await supaClient
    .from('games')
    .select('id')
    .eq('id', gameId)
    .maybeSingle();

  if (error) {
    console.error('ensureGameExists error:', error);
    return false;
  }
  if (!data) {
    console.warn('Game not found for id:', gameId);
    return false;
  }
  return true;
}


// --- 10. LOCATION SHARING LOGIC ---
const startSharing = async (gameId) => {
  if (locationInterval) clearInterval(locationInterval);

  // bail out if the game is gone / id mismatch
  if (!(await ensureGameExists(gameId))) {
    showToast('This game no longer exists, cannot start sharing.');
    return;
  }

  // Always start at Grant when sharing begins
  legStatusByGame[gameId] = 'initial';

  const ctrls = document.querySelector(`#game-${gameId} .location-controls`);
  if (ctrls) {
    const btnGrant = ctrls.querySelector('.pickup[data-status="picked_up_grant"]');
    const btnLuc   = ctrls.querySelector('.pickup[data-status="picked_up_luc"]');
    if (btnGrant) btnGrant.style.display = 'flex';
    if (btnLuc)   btnLuc.style.display   = 'none';
  }

  const channel = supaClient.channel(`game-${gameId}`);

  const share = () => {
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      if (!(await ensureGameExists(gameId))) return; // guard each tick

      const statusNow = legStatusByGame[gameId] || 'initial';
      const update = {
        game_id: gameId,
        user_id: currentUser.id,
        username: currentUser.user_metadata.username,
        lat: coords.latitude,
        lng: coords.longitude,
        status: statusNow
      };

      const { error } = await supaClient
        .from('live_locations')
        .upsert(update, { onConflict: 'game_id,user_id' }); // no spaces
      if (error) console.error('Upsert error:', error);

      getRoute(gameId, { lat: coords.latitude, lng: coords.longitude }, statusNow);
      channel.send({ type: 'broadcast', event: 'location_update', payload: update });
    }, (err) => {
      console.error('Geolocation error:', err);
      alert('Could not get location.');
      stopSharing();
    }, { enableHighAccuracy: true, maximumAge: 0 });
  };

  share();
  locationInterval = setInterval(share, 10000);
};




const stopSharing = () => {
    if (locationInterval) {
        clearInterval(locationInterval);
        locationInterval = null;
        console.log("Location sharing stopped.");
    }
};

// --- 11. EVENT LISTENERS ---
gamesList.addEventListener('click', async (e) => {
  const target = e.target.closest('button');
  if (!target) return;
  const gameId = target.dataset.id;
  if (!gameId) return;

  // Start sharing -> force initial leg to Grant, show correct buttons
  if (target.classList.contains('start-sharing')) {
    startSharing(gameId);
    target.style.display = 'none';
    const controls = target.parentElement;
    controls.querySelector('.stop-sharing').style.display = 'flex';
    const btnGrant = controls.querySelector('.pickup[data-status="picked_up_grant"]');
    const btnLuc   = controls.querySelector('.pickup[data-status="picked_up_luc"]');
    if (btnGrant) btnGrant.style.display = 'flex';
    if (btnLuc)   btnLuc.style.display   = 'none';
    return;
  }

  if (target.classList.contains('stop-sharing')) {
    stopSharing();
    target.style.display = 'none';
    target.previousElementSibling.style.display = 'flex';
    target.parentElement.querySelectorAll('.pickup').forEach(btn => btn.style.display = 'none');
    return;
  }

  // Pickup buttons: update status, toggle visibility, recompute route (do NOT call startSharing)
if (target.classList.contains('pickup')) {
  const newStatus = target.dataset.status;
  if (!(await ensureGameExists(gameId))) return;

  legStatusByGame[gameId] = newStatus;
  target.disabled = true;

  try {
    const controls = target.closest('.location-controls');
    const btnGrant = controls.querySelector('.pickup[data-status="picked_up_grant"]');
    const btnLuc   = controls.querySelector('.pickup[data-status="picked_up_luc"]');

    if (newStatus === 'picked_up_grant') {
      if (btnGrant) btnGrant.style.display = 'none';
      if (btnLuc)   btnLuc.style.display   = 'flex';
    } else if (newStatus === 'picked_up_luc') {
      if (btnGrant) btnGrant.style.display = 'none';
      if (btnLuc)   btnLuc.style.display   = 'none';
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        if (!(await ensureGameExists(gameId))) return;

        const update = {
          game_id: gameId,
          user_id: currentUser.id,
          username: currentUser.user_metadata.username,
          lat: coords.latitude,
          lng: coords.longitude,
          status: newStatus
        };

        const { error } = await supaClient
          .from('live_locations')
          .upsert(update, { onConflict: 'game_id,user_id' });
        if (error) console.error('Upsert error after pickup:', error);

        getRoute(gameId, { lat: coords.latitude, lng: coords.longitude }, newStatus);
        const channel = supaClient.channel(`game-${gameId}`);
        channel.send({ type: 'broadcast', event: 'location_update', payload: update });
      },
      (err) => console.error('Geolocation error after pickup:', err),
      { enableHighAccuracy: true, maximumAge: 0 }
    );
  } finally {
    target.disabled = false;
  }
  return;
}


  if (target.classList.contains('delete-btn')) {
    if (confirm('Are you sure you want to delete this game?')) {
      await supaClient.from('games').delete().match({ id: gameId });
      document.getElementById(`game-${gameId}`)?.remove();
    }
    return;
  }

  if (target.classList.contains('edit-btn')) {
    const { data: game } = await supaClient.from('games').select('*').eq('id', gameId).single();
    document.getElementById('edit-game-id').value = game.id;
    document.getElementById('edit-game-date').value = game.date;
    document.getElementById('edit-game-location').value = game.location;
    document.getElementById('edit-game-description').value = game.description;
    editModal.style.display = 'flex';
    return;
  }

  if (target.classList.contains('yes-btn')) {
    const { data: game } = await supaClient.from('games').select('availability').eq('id', gameId).single();
    const availability = game.availability;
    const userIndex = availability.going.findIndex(p => p.name === currentUser.user_metadata.username);
    if (userIndex !== -1) {
      availability.going[userIndex].booked = true;
      await supaClient.from('games').update({ availability }).match({ id: gameId });
      fetchGames();
    }
    return;
  }

  if (target.classList.contains('availability-btn')) {
    const status = target.dataset.status;
    const username = currentUser.user_metadata.username;
    const { data: game } = await supaClient.from('games').select('availability').eq('id', gameId).single();
    const availability = game.availability;

    availability.going = availability.going.filter(p => p.name !== username);
    availability.maybe = availability.maybe.filter(name => name !== username);
    availability.cant_make_it = availability.cant_make_it.filter(p => p.name !== username);

    const isSelected = target.classList.contains('selected');

    if (!isSelected) {
      if (status === 'going') {
        availability.going.push({ name: username, booked: false });
      } else if (status === 'maybe') {
        availability.maybe.push(username);
      } else if (status === 'cant_make_it') {
        document.getElementById('reason-game-id').value = gameId;
        reasonModal.style.display = 'flex';
        return;
      }
    }

    await supaClient.from('games').update({ availability }).match({ id: gameId });
    fetchGames();
  }
});


// --- 12. ADD A NEW GAME ---
addGameForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(addGameForm);
  const newGame = {
    date: formData.get('date'),
    location: formData.get('location'),
    description: formData.get('description'),
    user_id: currentUser.id,
    created_by: currentUser.user_metadata.username,
    is_driver: document.getElementById('game-is-driver')?.checked === true,
    availability: { going: [], maybe: [], cant_make_it: [] }
  };
  await supaClient.from('games').insert(newGame);
  addGameForm.reset();
  fetchGames();
});

// --- 13. EDIT MODAL LOGIC ---
editGameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const gameId = document.getElementById('edit-game-id').value;
    const updatedGame = {
        date: document.getElementById('edit-game-date').value,
        location: document.getElementById('edit-game-location').value,
        description: document.getElementById('edit-game-description').value,
    };
    await supaClient.from('games').update(updatedGame).match({ id: gameId });
    editModal.style.display = 'none';
    fetchGames();
});
cancelEditBtn.addEventListener('click', () => { editModal.style.display = 'none'; });

// --- 14. REASON MODAL LOGIC ---
reasonForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const gameId = document.getElementById('reason-game-id').value;
    const reason = document.getElementById('absence-reason').value;
    const username = currentUser.user_metadata.username;
    const { data: game } = await supaClient.from('games').select('availability').eq('id', gameId).single();
    const availability = game.availability;
    availability.going = availability.going.filter(p => p.name !== username);
    availability.maybe = availability.maybe.filter(name => name !== username);
    availability.cant_make_it.push({ name: username, reason: reason });
    await supaClient.from('games').update({ availability }).match({ id: gameId });
    reasonForm.reset();
    reasonModal.style.display = 'none';
    fetchGames();
});
cancelReasonBtn.addEventListener('click', () => { 
    reasonForm.reset();
    reasonModal.style.display = 'none'; 
});

// --- Surgical update for the availability section only ---
function updateAvailabilitySection(cardElement, availability) {
  const section = cardElement.querySelector('.availability-section');
  if (!section) return;

  const gameId = cardElement.id.replace('game-', '');
  const safe = availability || { going: [], maybe: [], cant_make_it: [] };
  const html = generateAvailabilityContent(safe, gameId);

  if (section.innerHTML !== html) {
    section.innerHTML = html;
  }
}

// 0 min -> green, 40+ -> red (tweak maxMins if you want)
function etaColor(minutes, maxMins = 40) {
  const m = Math.max(0, Math.min(minutes, maxMins));
  const hue = (1 - m / maxMins) * 120; // 120=green, 0=red
  return `hsl(${hue}, 80%, 45%)`;
}

// Haversine distance in miles
function haversineMiles(a, b) {
  const toRad = (x) => x * Math.PI / 180, R = 3958.7613;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Minimal toast
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  Object.assign(t.style, {
    position:'fixed', left:'50%', bottom:'24px', transform:'translateX(-50%)',
    background:'#111', color:'#fff', padding:'10px 14px', borderRadius:'10px',
    boxShadow:'0 6px 18px rgba(0,0,0,.25)', zIndex:9999, fontWeight:'700'
  });
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2800);
}
