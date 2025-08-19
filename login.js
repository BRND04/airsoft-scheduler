// --- 1. SET UP SUPABASE ---
// MAKE SURE YOU HAVE REPLACED THESE WITH YOUR REAL KEYS
const SUPABASE_URL = 'https://foqlzzkmuorokqsqjtbk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvcWx6emttdW9yb2txc3FqdGJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU2MzUwNjksImV4cCI6MjA3MTIxMTA2OX0.einCfTr3Cta51n3fOOET4Hz6p0KtRHy5NAoDTCgIbBg';

// A simpler, more direct way to initialize the client
const supaClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DEBUGGING: Check the console to see if this object was created correctly.
// It should have an 'auth' property inside it.
console.log('Supabase Client Initialized:', supaClient);


// --- 2. GRAB HTML ELEMENTS ---
const loginForm = document.getElementById('login-form');
const messageDisplay = document.getElementById('message-display');

// --- 3. LOGIN LOGIC ---
loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('email').value;
    const username = document.getElementById('username').value;
    
    loginForm.querySelector('button').disabled = true;
    messageDisplay.textContent = 'Sending...';

    // Use our new 'supaClient' variable
    const { error } = await supaClient.auth.signInWithOtp({
        email: email,
        options: {
            data: { 
                username: username 
            },
            emailRedirectTo: `${window.location.origin}/scheduler.html`,
        },
    });

    if (error) {
        messageDisplay.textContent = `Error: ${error.message}`;
        console.error('Error signing in:', error);
        loginForm.querySelector('button').disabled = false;
    } else {
        messageDisplay.textContent = 'Success! Check your email for the magic link.';
    }
});
