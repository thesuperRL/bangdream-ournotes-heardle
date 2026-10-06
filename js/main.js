async function loadData() {
    try {
        const [songsRes, orderRes] = await Promise.all([
            fetch('songs/songs.json'),
            fetch('songs/order.json'),
        ]);
        const songs = await songsRes.json();
        const schedule = await orderRes.json();
        order = schedule.order;
        STARTDATE = schedule.start;
        console.log("Data loaded:", songs);
        return songs;
    } catch (error) {
        console.error("Failed to load data:", error);
    }
}

let SongDict;
let ArrGuesses = [];

let order = [];

// Day 0 of the current rotation; set from songs/order.json, which the rotate
// workflow rewrites whenever every song has had its day.
let STARTDATE;

// Clips are already trimmed to the part we want, so playback starts at 0.
// Anything above 0 needs a backwards seek that only works on hosts serving
// HTTP Range requests (GitHub Pages does, python -m http.server does not).
const OFFSET = 0;

const searchInput = document.getElementById('search-input');
const suggestionsContainer = document.getElementById('suggestions');
const submitBtn = document.getElementById('submit-btn');
const skipBtn = document.getElementById('skip-btn');
const langSelect = document.getElementById('lang-select');

// Language the song titles are shown and guessed in ('en' romanized, 'ja' native)
let lang = localStorage.getItem('lang') || 'en';

// Array to keep track of wrong guesses
let wrongGuesses = [];
const wrongGuessSecondsReceived = [1, 2, 3, 4, 5]
const wrongGuessSecondsCumulative = [1, 2, 4, 7, 11, 16, 16]

// Current answer
// NOT named `Number`: a top-level `let` shadows the global constructor for
// every script on the page, which breaks Bootstrap's modals.
let SongIndex;
let Answer;
let ClipURL;
let mode = "Daily";

// popup
let ucpopup;

// countdown recording
let countdown;

const btnPlay = document.getElementById('btnPlay');
const progressBar = document.getElementById('progressBar');
const currentTimeDisplay = document.getElementById('currentTime');
const durationDisplay = document.getElementById('duration');

let audio = null;
let isPlaying = false;
let playTimer;
let progressInterval;
const maxDuration = 16; // Progress bar goes up to 16 seconds

// Initialize the player
function initPlayer() {
    if (audio) {
        audio.pause();
        audio.src = '';
    }
    audio = new Audio(ClipURL);
    audio.preload = 'auto';
    durationDisplay.textContent = '0:16';
}

document.addEventListener('DOMContentLoaded', async function () {
    // Format seconds into MM:SS
    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    // Update progress bar
    function updateProgress(currentTime) {
        const progressPercent = ((currentTime - OFFSET) / maxDuration) * 100;
        progressBar.style.width = `${progressPercent}%`;
        currentTimeDisplay.textContent = formatTime(currentTime - OFFSET);
    }

    // Play the clip from OFFSET for as many seconds as have been unlocked
    function playFirstFewSeconds() {
        audio.currentTime = OFFSET;
        audio.play();
        isPlaying = true;
        btnPlay.innerHTML = '&#10074;&#10074;';

        let currentTime = OFFSET;
        updateProgress(currentTime);

        progressInterval = setInterval(() => {
            currentTime += 0.1;
            updateProgress(currentTime);

            if (currentTime - OFFSET >= wrongGuessSecondsCumulative[wrongGuesses.length]) {
                stopPlayback();
            }
        }, 100);

        // Stop after OFFSET seconds
        playTimer = setTimeout(stopPlayback, (wrongGuessSecondsCumulative[wrongGuesses.length] + OFFSET) * 1000);
    }

    // Stop playback
    function stopPlayback() {
        clearInterval(progressInterval);
        clearTimeout(playTimer);
        audio.pause();
        isPlaying = false;
        btnPlay.innerHTML = "&#9658;";
    }

    // Event listener for play button
    btnPlay.addEventListener('click', async function () {
        if (isPlaying) {
            stopPlayback();
        } else {
            playFirstFewSeconds();
        }
    });

    SongDict = await loadData()

    console.log(SongDict)
    console.log(SongDict.length)

    SongIndex = order[daysSinceStartDate() % order.length];

    langSelect.value = lang;
    langSelect.addEventListener('change', () => {
        lang = langSelect.value;
        localStorage.setItem('lang', lang);
        buildGuesses();
        searchInput.value = '';
        validateInput();
        suggestionsContainer.style.display = 'none';
    });

    buildGuesses();
    ClipURL = SongDict[SongIndex]['file'];

    console.log(ArrGuesses);
    console.log(Answer);
    console.log(ClipURL);

    // Initialize the player
    initPlayer();
});

// Guess label for a song in the currently selected language.
function songLabel(song) {
    const title = (song.titles && song.titles[lang]) || song.title;
    return song.type === "Cover"
        ? `${title} [${song.source} cover] - ${song.performer}`
        : `${title} - ${song.performer}`;
}

// Rebuild the guess list (and the answer) for the current language.
function buildGuesses() {
    ArrGuesses = SongDict.map(songLabel);
    Answer = ArrGuesses[SongIndex];
}

// Function to check if input matches any item (case-insensitive)
function isValidInput(input) {
    return ArrGuesses.some(item =>
        item.toLowerCase() === input.toLowerCase().trim()
    );
}

function daysSinceStartDate() {
    // Parse the STARTDATE string into a Date object in UTC
    const startDate = new Date(STARTDATE);
    const startDateUTC = Date.UTC(
        startDate.getUTCFullYear(),
        startDate.getUTCMonth(),
        startDate.getUTCDate()
    );

    // Get current UTC date (with time set to midnight for accurate comparison)
    const now = new Date();
    const todayUTC = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
    );

    // Calculate the difference in milliseconds
    const diffTime = todayUTC - startDateUTC;

    // Convert milliseconds to days
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    // Return 0 if negative (future date) or the day count
    return Math.max(0, diffDays);
}

// Function to filter items based on search input
function getSuggestions(searchTerm) {
    return ArrGuesses.filter(item =>
        item.toLowerCase().includes(searchTerm.toLowerCase())
    );
}

// Function to display suggestions
function showSuggestions(suggestions) {
    if (suggestions.length === 0 || searchInput.value === '') {
        suggestionsContainer.style.display = 'none';
        return;
    }

    suggestionsContainer.innerHTML = '';
    suggestions.forEach(suggestion => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.textContent = suggestion;
        div.addEventListener('click', () => {
            searchInput.value = suggestion;
            suggestionsContainer.style.display = 'none';
            validateInput();
        });
        suggestionsContainer.appendChild(div);
    });
    suggestionsContainer.style.display = 'block';
}

// Function to validate input and update UI
function validateInput() {
    const inputValue = searchInput.value.trim();
    const isValid = isValidInput(inputValue);

    // Update submit button state
    submitBtn.disabled = !isValid;

    // Update input border color
    if (inputValue === '') {
        searchInput.classList.remove('valid-input', 'invalid-input');
    } else {
        searchInput.classList.toggle('valid-input', isValid);
        searchInput.classList.toggle('invalid-input', !isValid);
    }
}

function checkGuess(inputValue) {
    // Get the input value (assuming INPUT is a variable containing the current guess)
    const guess = inputValue;

    // Check if the guess matches the ANSWER
    if (guess === Answer) {
        // Handle correct guess (you can add your logic here)
        console.log("Correct guess!");
        ucpopup = createUnclosablePopup(`You got today's BanG Dream! Our Notes Heardle within ${wrongGuessSecondsCumulative[wrongGuesses.length]} second(s).`, {
            title: 'Correct guess!',
            backgroundColor: '#f8d7da',
            textColor: '#721c24',
            guessed: true
        });
        return true;
    } else {
        // Add wrong guess to the array
        wrongGuesses.push(guess);

        // Set Guess Skip Number
        if (wrongGuesses.length < 5) {
            skipBtn.textContent = "Skip (+" + wrongGuessSecondsReceived[wrongGuesses.length] + "s)";
        } else {
            skipBtn.textContent = "Skip";
        }

        // Update HTML elements with wrong guesses
        for (let i = 0; i < Math.min(wrongGuesses.length, 6); i++) {
            const element = document.getElementById(`guess${i + 1}`);
            if (element) {
                element.textContent = wrongGuesses[i];
                if (i === Math.min(wrongGuesses.length, 6) - 1) {
                    element.classList.remove('col-sm-middle');
                    element.classList.add('col-sm-middle-guessed');
                }
            }
        }

        // light the next one
        console.log(wrongGuesses.length);
        const element = document.getElementById(`guess${wrongGuesses.length + 1}`);
        if (element) {
            element.classList.remove('col-sm-middle');
            element.classList.add('col-sm-middle-guessed');
        }

        if (wrongGuesses.length === 6) {
            const popup = createUnclosablePopup("You didn't get today's BanG Dream! Our Notes Heardle. Better luck tomorrow!", {
                title: 'Nice Try!',
                backgroundColor: '#f8d7da',
                textColor: '#721c24',
                guessed: false
            });
        }

        return false;
    }
}

// Function to handle the submitted input
function handleSubmit() {
    const inputValue = searchInput.value.trim();
    console.log('Submitted value:', inputValue);
    // You can do whatever you need with the input value here
    checkGuess(inputValue);
}

// Function to handle skipped guesses
function handleSkip() {
    console.log("Skipped Guess");
    checkGuess("Skipped...");
}

// Event listeners
searchInput.addEventListener('input', () => {
    const suggestions = getSuggestions(searchInput.value);
    showSuggestions(suggestions);
    validateInput();
});

searchInput.addEventListener('focus', () => {
    const suggestions = getSuggestions(searchInput.value);
    showSuggestions(suggestions);
    validateInput();
});

// Submit button click handler
submitBtn.addEventListener('click', handleSubmit);
// Skip button click handler
skipBtn.addEventListener('click', handleSkip);

// Also allow Enter key in the input field to submit
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !submitBtn.disabled) {
        handleSubmit();
    }
});

// Hide suggestions when clicking outside
document.addEventListener('click', (e) => {
    if (e.target !== searchInput && e.target !== submitBtn) {
        suggestionsContainer.style.display = 'none';
    }
});

document.addEventListener('DOMContentLoaded', function () {
    // Get modal elements
    const modal = document.getElementById('customModal');
    const modalTitle = document.getElementById('customModalLabel');
    const modalBody = document.getElementById('customModalBody');

    // When a popup link is clicked
    document.querySelectorAll('.popup-link').forEach(link => {
        link.addEventListener('click', function () {
            // Set modal title and content from data attributes
            const title = this.getAttribute('data-popup-title') || 'Modal';
            const content = this.getAttribute('data-popup-content') || 'Content not specified';

            modalTitle.textContent = title;
            modalBody.innerHTML = content;
        });
    });

    // Optional: Reset modal content when closed
    modal.addEventListener('hidden.bs.modal', function () {
        modalTitle.textContent = 'Modal Title';
        modalBody.textContent = 'Modal content will appear here...';
    });
});

function createUnclosablePopup(content, options = {}) {
    // Set default options
    const config = {
        title: options.title || 'Important Notice',
        backgroundColor: options.backgroundColor || '#ffffff',
        textColor: options.textColor || '#000000',
        ...options
    };

    // Create overlay and popup if they don't exist
    let overlay = document.getElementById('unclosableOverlay');
    let popup = document.getElementById('unclosablePopup');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'unclosableOverlay';
        overlay.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.7);
                    z-index: 9998;
                `;
        document.body.appendChild(overlay);
    }

    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'unclosablePopup';
        popup.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background-color: black;
                    color: #999999;
                    padding: 30px;
                    border-radius: 5px;
                    border: 1px solid #999999;
                    box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
                    z-index: 9999;
                    max-width: 80%;
                    max-height: 80vh;
                    overflow-y: auto;
                    text-align: center; /* Center text */
                    display: flex; /* Flexbox for better centering */
                    flex-direction: column; /* Stack children vertically */
                    align-items: center; /* Center horizontally */
                    justify-content: center; /* Center vertically */
                `;
        document.body.appendChild(popup);
    }

    // Set the popup content
    // The 24s clip is all we host; the end screen plays the real song from the
    // YouTube upload the clip was cut from (the same one credits.html lists).
    const credit = SongDict[SongIndex].credit;
    const videoId = credit ? new URLSearchParams(credit.url.split('?')[1]).get('v') : null;
    const player = videoId
        ? `<iframe id="end-video" width="320" height="180" frameborder="0" allow="autoplay"
                allowfullscreen src="https://www.youtube.com/embed/${videoId}?autoplay=1"></iframe>`
        : '';

    popup.innerHTML = `
                <h4 id="end-result"> ${config.title} </h4>
                <p>The correct answer was <a href="${ClipURL}" target="_blank">"${Answer}"</a></p>
                ${player}
                <p id="tries-used">${content}</p>
                <button id="share-btn"> 
                    SHARE 
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-share" viewBox="0 0 16 16">
                      <path d="M13.5 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M11 2.5a2.5 2.5 0 1 1 .603 1.628l-6.718 3.12a2.5 2.5 0 0 1 0 1.504l6.718 3.12a2.5 2.5 0 1 1-.488.876l-6.718-3.12a2.5 2.5 0 1 1 0-3.256l6.718-3.12A2.5 2.5 0 0 1 11 2.5m-8.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m11 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"/>
                    </svg>
                </button>
                <div id="status"></div>
                <p class="description">Time until the next song: </p>
                <div class="countdown-display" id="countdown">23:59:59</div>
                <button id="endless-btn"> 
                    ENDLESS MODE 
                </button>
            `;

    // Assign countdown
    countdown = document.getElementById('countdown');

    // Show the popup and overlay
    overlay.style.display = 'block';
    popup.style.display = 'block';
    document.body.classList.add('unclosable-popup-open');

    // Stop the clip so it does not play over the video.
    if (audio) {
        audio.pause();
        isPlaying = false;
        btnPlay.innerHTML = "&#9658;";
    }

    // Button click handler
    document.getElementById('share-btn').addEventListener('click', async () => {
        const button = document.getElementById('share-btn');
        const status = document.getElementById('status');

        // Call your function to get the content
        const content = generateContent(options.guessed);

        // Try to copy to clipboard
        const success = await copyToClipboard(content);

        if (success) {
            // Visual feedback
            button.textContent = 'Copied!';
            button.classList.add('copied');
            status.textContent = 'Content copied to clipboard!';

            // Reset button after 2 seconds
            setTimeout(() => {
                button.textContent = 'Copy to Clipboard';
                button.classList.remove('copied');
                status.textContent = '';
            }, 2000);
        } else {
            status.textContent = 'Failed to copy to clipboard.';
        }
    });

    document.getElementById('endless-btn').addEventListener('click', async () => {
        SongIndex = getRandomInt(0, SongDict.length - 1);

        Answer = ArrGuesses[SongIndex];
        ClipURL = SongDict[SongIndex]['file'];
        console.log(Answer);
        console.log(ClipURL);

        // clear wrong answers
        wrongGuesses = [];
        // Un-update HTML elements with wrong guesses
        for (let i = 0; i < 6; i++) {
            const element = document.getElementById(`guess${i + 1}`);
            if (element) {
                element.innerHTML = "<br><br>";
                if (i !== 0) {
                    // unlight it
                    element.classList.remove('col-sm-middle-guessed');
                    element.classList.add('col-sm-middle');
                }
            }
        }

        // set mode to endless
        mode = "Endless";

        // reset skip btn content
        skipBtn.textContent = "Skip (+" + wrongGuessSecondsReceived[wrongGuesses.length] + "s)";

        // re-initialize the player
        initPlayer();

        // Close the popup. Hiding the iframe would keep it playing, so drop it.
        popup.innerHTML = '';
        overlay.style.display = 'none';
        popup.style.display = 'none';
        document.body.classList.remove('unclosable-popup-open');
        window.close = originalWindowClose;
    });

    // Disable all methods of closing
    // 1. Prevent clicking outside
    overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
    });

    // 2. Prevent Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    // 3. Prevent right-click context menu
    popup.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // 4. Prevent any other potential closing methods
    const originalWindowClose = window.close;
    window.close = function () {
        console.log('Window closing has been disabled while the popup is active');
        return null;
    };

    // Return a function that can close the popup (if you need it)
    return {
        close: () => {
            overlay.style.display = 'none';
            popup.style.display = 'none';
            document.body.classList.remove('unclosable-popup-open');
            window.close = originalWindowClose;
        }
    };
}

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatDateUTC(date) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const utcYear = date.getUTCFullYear();
    const utcMonth = months[date.getUTCMonth()]; // Get month name (e.g., "Aug")
    const utcDay = date.getUTCDate();

    return `${utcMonth} ${utcDay}, ${utcYear}`; // Example: "Aug 7, 2025"
}

// Function that generates the content to be copied
function generateContent(isGuessed) {
    const date = new Date();
    const formattedDate = formatDateUTC(date)

    let answer = ""
    if (mode == "Endless") {
        answer = `\n\n Song: ${Answer}`;
    }

    return `BanG Dream! Our Notes ${mode} Heardle #${SongIndex}, ${formattedDate} (UTC) ${answer}

${generateGuessNumbers(isGuessed)}`;
}

function generateGuessNumbers(isGuessed) {
    const right = "🟩";
    const rightSound = "🔊";
    const wrong = "⬛️";
    const wrongSound = "🔇";
    const unguessed = "⬜️";

    let clipboardemojis = "";

    if (isGuessed) {
        clipboardemojis += rightSound;
    } else {
        clipboardemojis += wrongSound;
    }

    for (let i = 0; i < wrongGuesses.length; i++) {
        clipboardemojis += wrong;
    }

    if (!isGuessed) {
        return clipboardemojis;
    } else {
        clipboardemojis += right;
    }
    console.log(clipboardemojis.length);

    for (let i = clipboardemojis.length / 2; i < 7; i++) {
        clipboardemojis += unguessed;
        console.log("called");
    }

    return clipboardemojis;
}

// Function to copy text to clipboard
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy: ', err);
        return false;
    }
}

function updateCountdown() {
    // Get current UTC time
    const now = new Date();

    // Calculate time until next UTC day (midnight)
    const nextDay = new Date(now);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    nextDay.setUTCHours(0, 0, 0, 0);

    const diff = nextDay - now;

    // Convert milliseconds to hours, minutes, seconds
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    // Format with leading zeros

    if (countdown) {
        // Update the display
        countdown.textContent = String(hours).padStart(2, '0') + ":" +
            String(minutes).padStart(2, '0') + ":" +
            String(seconds).padStart(2, '0');
    }
}

// Update immediately and then every second
updateCountdown();
setInterval(updateCountdown, 1000);