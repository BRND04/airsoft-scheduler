// --- 1. SET UP SUPABASE ---
const SUPABASE_URL = 'https://foqlzzkmuorokqsqjtbk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI_NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvcWx6emttdW9yb2txc3FqdGJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU2MzUwNjksImV4cCI6MjA3MTIxMTA2OX0.einCfTr3Cta51n3fOOET4Hz6p0KtRHy5NAoDTCgIbBg';
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
// New elements for collapsible form
const formHeader = addGameForm.querySelector('.form-header');
let currentUser = null;

// --- 3. AUTHENTICATION & INITIAL LOAD ---
supaClient.auth.onAuthStateChange((event, session) => {
    if (!session) {
        window.location.href = 'index.html';
    } else {
        currentUser = session.user;
        document.getElementById('user-display').textContent = `Signed in as: ${currentUser.user_metadata.username}`;
        fetchGames();
        setInterval(fetchGames, 10000); 
    }
});

// --- 4. COLLAPSIBLE FORM LOGIC ---
formHeader.addEventListener('click', () => {
    addGameForm.classList.toggle('collapsed');
});


// --- 5. FETCH & DISPLAY GAMES ---
const fetchGames = async () => {
    const { data: games, error } = await supaClient
        .from('games')
        .select('*')
        .order('date', { ascending: true });

    if (error) {
        console.error('Error fetching games:', error);
        return;
    }

    const newHtml = games.map(game => renderGameCard(game)).join('');
    if (document.getElementById('games-list').innerHTML !== newHtml) {
        document.getElementById('games-list').innerHTML = newHtml || '<h3>No upcoming games scheduled.</h3>';
    }
};

// --- 6. RENDER A SINGLE GAME CARD ---
const renderGameCard = (game) => {
    const availability = game.availability || { going: [], maybe: [], cant_make_it: [] };
    const username = currentUser.user_metadata.username;
    
    const currentUserGoing = availability.going.find(p => p.name === username);

    const calculateCountdown = (gameDateStr) => {
        const gameDate = new Date(gameDateStr).getTime();
        const now = new Date().getTime();
        const distance = gameDate - now;
        if (distance < 0) return "Game day has passed!";
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        return `<span>${days}d</span> <span>${hours}h</span>`;
    };

    const renderGoingAttendeeList = (attendees) => {
        if (!attendees || attendees.length === 0) return '<li>None yet</li>';
        return attendees.map(person => `
            <li>
                ${person.name}
                ${person.booked ? '<i class="fas fa-ticket-alt booking-icon" title="Booked!"></i>' : ''}
            </li>
        `).join('');
    };
    
    const renderReasonAttendeeList = (attendees) => {
        if (!attendees || attendees.length === 0) return '<li>None yet</li>';
        return attendees.map(person => `<li data-tooltip="${person.reason || 'No reason given'}">${person.name}</li>`).join('');
    };

    const adminControls = game.user_id === currentUser.id ? `
        <div class="game-card-actions">
            <button class="icon-button edit-btn" data-id="${game.id}" title="Edit Game"><i class="fas fa-pencil-alt"></i></button>
            <button class="icon-button delete-btn" data-id="${game.id}" title="Delete Game"><i class="fas fa-trash-alt"></i></button>
        </div>
    ` : '';
    
    const notesSection = game.description ? `
        <div class="game-notes">
            <h4 class="card-section-heading">Notes:</h4>
            <p>${game.description}</p>
        </div>
    ` : '';
    
    const countdownSection = `
        <div class="countdown-wrapper">
            <h4 class="card-section-heading">Countdown:</h4>
            <div class="game-countdown">${calculateCountdown(game.date)}</div>
        </div>
    `;

    const bookingSection = (currentUserGoing && !currentUserGoing.booked) ? `
        <div class="booking-confirmation">
            <h4 class="card-section-heading">Have you booked yet?</h4>
            <div class="booking-buttons">
                <button class="booking-btn yes-btn" data-id="${game.id}">Yes</button>
                <a href="https://area-66.co.uk/shop" target="_blank" class="booking-btn no-btn">No</a>
            </div>
        </div>
    ` : '';

    return `
    <div class="game-card" id="game-${game.id}">
        <div class="game-card-header">
            <div><h3>${game.location}</h3><p><strong>Date:</strong> ${new Date(game.date).toLocaleDateString()}</p></div>
        </div>
        ${adminControls}
        ${countdownSection}
        ${notesSection}
        ${bookingSection}
        <div class="availability-section">
            <div class="availability-controls">
                <button class="availability-btn going ${currentUserGoing ? 'selected' : ''}" data-id="${game.id}" data-status="going">Going</button>
                <button class="availability-btn maybe ${availability.maybe.includes(username) ? 'selected' : ''}" data-id="${game.id}" data-status="maybe">Maybe</button>
                <button class="availability-btn cant-make-it ${availability.cant_make_it.some(p => p.name === username) ? 'selected' : ''}" data-id="${game.id}" data-status="cant_make_it">Can't Go</button>
            </div>
            <div class="availability-display">
                <div class="status-column going"><h4>✅ Going (${availability.going.length})</h4><ul class="attendee-list">${renderGoingAttendeeList(availability.going)}</ul></div>
                <div class="status-column maybe"><h4>🤔 Maybe (${availability.maybe.length})</h4><ul class="attendee-list">${availability.maybe.map(name => `<li>${name}</li>`).join('') || '<li>None yet</li>'}</ul></div>
                <div class="status-column cant-make-it"><h4>❌ Can't Go (${availability.cant_make_it.length})</h4><ul class="attendee-list">${renderReasonAttendeeList(availability.cant_make_it)}</ul></div>
            </div>
        </div>
    </div>
    `;
};

// --- 7. EVENT LISTENERS ---
gamesList.addEventListener('click', async (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    const gameId = target.dataset.id;
    if (!gameId) return;

    if (target.classList.contains('delete-btn')) {
        if (confirm('Are you sure you want to delete this game?')) {
            await supaClient.from('games').delete().match({ id: gameId });
            fetchGames();
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

// --- 8. ADD A NEW GAME ---
addGameForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(addGameForm);
    const newGame = {
        date: formData.get('date'), location: formData.get('location'), description: formData.get('description'),
        user_id: currentUser.id, created_by: currentUser.user_metadata.username,
        availability: { going: [], maybe: [], cant_make_it: [] }
    };
    await supaClient.from('games').insert(newGame);
    addGameForm.reset();
    fetchGames();
});

// --- 9. EDIT MODAL LOGIC ---
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

// --- 10. REASON MODAL LOGIC ---
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
