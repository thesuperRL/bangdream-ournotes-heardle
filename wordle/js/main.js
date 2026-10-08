// Datasets are shared by every game in this repo, so they live at the site
// root rather than inside this folder. Paths stored inside a dataset (a
// character's "icon", for instance) are relative to this prefix.
const DATA = '../data/';

async function loadData() {
    try {
        const [charsRes, orderRes] = await Promise.all([
            fetch(DATA + 'characters/characters.json'),
            fetch(DATA + 'characters/order.json'),
        ]);
        const characters = await charsRes.json();
        const schedule = await orderRes.json();
        order = schedule.order;
        STARTDATE = schedule.start;
        return characters;
    } catch (error) {
        console.error("Failed to load data:", error);
    }
}

let CharDict;
// One search label per character, index-aligned with CharDict.
let ArrGuesses = [];

let order = [];

// Day 0 of the current rotation; set from data/characters/order.json, which
// the rotate workflow rewrites whenever every character has had their day.
let STARTDATE;

const MAX_GUESSES = 5;

// School years in ascending order, so a guess can be compared against the
// answer and rendered with an arrow. Plain string equality would not tell a
// player which direction to move.
const YEAR_RANK = {
    JHS1: 1, JHS2: 2, JHS3: 3,
    HS1: 4, HS2: 5, HS3: 6,
    Univ1: 7,
};

// Human-readable form of the compact year codes stored in characters.json.
const YEAR_LABEL = {
    JHS1: 'Jr High 1', JHS2: 'Jr High 2', JHS3: 'Jr High 3',
    HS1: 'High 1', HS2: 'High 2', HS3: 'High 3',
    Univ1: 'Uni 1',
};

// Band name -> logo file stem. Written by scripts/download_character_icons.py,
// which keys the same slugs.
const BAND_SLUGS = {
    'MyGO!!!!!': 'mygo',
    'Ave Mujica': 'avemujica',
    'Mugendai MewType': 'mewtype',
    'millsage': 'millsage',
    'Ikka Dumb Rock!': 'ikka',
};

// Shown instead of the logo where the column is too narrow for one. Trimmed to
// the part that identifies the band on sight; all five stay unambiguous.
const BAND_SHORT = {
    'MyGO!!!!!': 'MyGO',
    'Ave Mujica': 'Ave Mujica',
    'Mugendai MewType': 'MewType',
    'millsage': 'millsage',
    'Ikka Dumb Rock!': 'Ikka',
};

const searchInput = document.getElementById('search-input');
const suggestionsContainer = document.getElementById('suggestions');
const submitBtn = document.getElementById('submit-btn');
const langSelect = document.getElementById('lang-select');
const guessRows = document.getElementById('guess-rows');
const guessesLeft = document.getElementById('guesses-left');

// Language the character names are shown and guessed in ('en' romanised,
// 'ja' native).
let lang = localStorage.getItem('lang') || 'en';

// Every guessed character, in order. Characters are stored as objects rather
// than label strings so switching language can re-render the board without
// the old labels going stale.
let guessHistory = [];

// Current answer
// NOT named `Number`: a top-level `let` shadows the global constructor for
// every script on the page, which breaks Bootstrap's modals.
let CharIndex;
let Answer;
let mode = "Daily";

// popup
let ucpopup;

// countdown recording
let countdown;

// ---- Labels and lookup ---------------------------------------------------

// Guess label for a character in the currently selected language. The stage
// name rides along so Ave Mujica members are findable either way.
function charLabel(char) {
    const name = char.names[lang] || char.names.en;
    return char.stageName ? `${name} (${char.stageName})` : name;
}

// Rebuild the guess list for the current language.
function buildGuesses() {
    ArrGuesses = CharDict.map(charLabel);
}

// Function to check if input matches any item (case-insensitive)
function isValidInput(input) {
    return ArrGuesses.some(item =>
        item.toLowerCase() === input.toLowerCase().trim()
    );
}

// Character behind a submitted label, or null if the label is not one of ours.
function charFromLabel(label) {
    const index = ArrGuesses.findIndex(
        item => item.toLowerCase() === label.toLowerCase().trim());
    return index === -1 ? null : CharDict[index];
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

// ---- Birthdays -----------------------------------------------------------

// Birthdays are never a guessable column; they only decide whether solving a
// character earns confetti. The window runs from the birthday itself through
// the seven days after it.
const BIRTHDAY_WINDOW_DAYS = 7;

// Whole days from a "MM-DD" birthday to today in UTC, or -1 when the birthday
// is still ahead. Last year's date is checked too so a birthday in late
// December still counts through early January.
function daysSinceBirthday(birthday) {
    const [month, day] = birthday.split('-').map(Number);
    const now = new Date();
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    for (const year of [now.getUTCFullYear(), now.getUTCFullYear() - 1]) {
        const elapsed = Math.floor(
            (todayUTC - Date.UTC(year, month - 1, day)) / (1000 * 60 * 60 * 24));
        if (elapsed >= 0) {
            return elapsed;
        }
    }
    return -1;
}

function inBirthdayWindow(char) {
    if (!char.birthday) {
        return false;
    }
    const elapsed = daysSinceBirthday(char.birthday);
    return elapsed >= 0 && elapsed <= BIRTHDAY_WINDOW_DAYS;
}

// ---- Suggestions ---------------------------------------------------------

// Matches on the visible label and, separately, on the stage name: a player
// typing "Doloris" in Japanese mode should still reach Misumi Uika.
function getSuggestions(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    const matches = [];
    for (let i = 0; i < CharDict.length; i++) {
        const char = CharDict[i];
        const label = ArrGuesses[i];
        const haystack = [label, char.names.en, char.names.ja, char.stageName || '']
            .join(' ')
            .toLowerCase();
        if (haystack.includes(term)) {
            matches.push({ char, label });
        }
    }
    return matches;
}

// Function to display suggestions
function showSuggestions(suggestions) {
    if (suggestions.length === 0 || searchInput.value === '') {
        suggestionsContainer.style.display = 'none';
        return;
    }

    suggestionsContainer.innerHTML = '';
    suggestions.forEach(({ char, label }) => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';

        const icon = document.createElement('img');
        icon.src = DATA + char.icon;
        icon.alt = '';
        div.appendChild(icon);

        const text = document.createElement('span');
        text.textContent = label;
        div.appendChild(text);

        div.addEventListener('click', () => {
            searchInput.value = label;
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

// ---- Board ---------------------------------------------------------------

const CELL_CLASSES = [
    'cell-icon', 'cell-name', 'cell-band',
    'cell-positions', 'cell-year', 'cell-height', 'cell-school',
];

// Rebuild all MAX_GUESSES rows from guessHistory. Doing the whole board rather
// than patching one row keeps language switches and endless resets free.
function renderBoard() {
    guessRows.innerHTML = '';
    for (let i = 0; i < MAX_GUESSES; i++) {
        const row = document.createElement('tr');
        row.className = 'guess-row';
        CELL_CLASSES.forEach(cls => {
            const cell = document.createElement('td');
            cell.className = cls;
            row.appendChild(cell);
        });

        const played = guessHistory[i];
        if (played) {
            fillRow(row, played);
        } else {
            row.classList.add('empty');
        }
        guessRows.appendChild(row);
    }

    const left = MAX_GUESSES - guessHistory.length;
    guessesLeft.textContent = `${left} guess${left === 1 ? '' : 'es'} left`;
}

// Direction a player has to move to reach the answer: up when the answer is
// the larger value, down when it is smaller, nothing when they match.
function arrowFor(guessValue, answerValue) {
    if (guessValue === answerValue) return '';
    return guessValue < answerValue ? '\u2191' : '\u2193';
}

function setCell(cell, text, arrow) {
    cell.textContent = text;
    if (arrow) {
        const badge = document.createElement('span');
        badge.className = 'arrow-badge';
        badge.textContent = arrow;
        cell.appendChild(badge);
    }
}

function fillRow(row, char) {
    // Icon
    const icon = document.createElement('img');
    icon.src = DATA + char.icon;
    icon.alt = char.names.en;
    row.cells[0].appendChild(icon);

    // Name: the selected language first, the other in parentheses, with the
    // Ave Mujica stage name on its own line.
    const primary = char.names[lang] || char.names.en;
    const secondary = lang === 'en' ? char.names.ja : char.names.en;
    row.cells[1].textContent = char.stageName
        ? `${primary}\n(${secondary})\n${char.stageName}`
        : `${primary}\n(${secondary})`;

    // Band: the logo, with a short name beside it. A phone cannot give the
    // band column enough width for a logo to stay legible, so CSS swaps to the
    // name there. Dropping the image on error makes the name visible too,
    // which is the fallback when a logo file is missing.
    const logo = document.createElement('img');
    logo.src = `${DATA}characters/logos/${BAND_SLUGS[char.band]}.png`;
    logo.alt = char.band;
    logo.addEventListener('error', () => logo.remove());
    const bandName = document.createElement('span');
    bandName.className = 'band-name';
    bandName.textContent = BAND_SHORT[char.band] || char.band;
    row.cells[2].append(logo, bandName);
    if (char.band === Answer.band) {
        row.cells[2].classList.add('match-full');
    }

    // Positions: full match when the sets are identical, partial when they
    // merely overlap (a guitarist guessed against a singing guitarist).
    const shared = char.positions.filter(p => Answer.positions.includes(p));
    row.cells[3].textContent = char.positions.join(', ');
    if (shared.length === char.positions.length
        && shared.length === Answer.positions.length) {
        row.cells[3].classList.add('match-full');
    } else if (shared.length > 0) {
        row.cells[3].classList.add('match-partial');
    }

    // Year and height are comparisons, not equalities: they stay dim and carry
    // the arrow, so an exact hit reads as "right value" without claiming the
    // whole character is right.
    setCell(row.cells[4], YEAR_LABEL[char.year] || char.year,
        arrowFor(YEAR_RANK[char.year], YEAR_RANK[Answer.year]));
    row.cells[4].classList.add('match-partial');

    setCell(row.cells[5], `${char.height} cm`,
        arrowFor(char.height, Answer.height));
    row.cells[5].classList.add('match-partial');

    // School
    row.cells[6].textContent = char.school;
    if (char.school === Answer.school) {
        row.cells[6].classList.add('match-full');
    }
}

// ---- Guessing ------------------------------------------------------------

function checkGuess(inputValue) {
    const guessedChar = charFromLabel(inputValue);
    if (!guessedChar) {
        return false;
    }

    const correct = guessedChar.id === Answer.id;
    guessHistory.push(guessedChar);
    renderBoard();

    searchInput.value = '';
    validateInput();
    suggestionsContainer.style.display = 'none';

    if (correct) {
        ucpopup = createUnclosablePopup(
            `You got today's BanG Dream! Our Notes character in ${guessHistory.length} guess(es).`,
            { title: 'Correct guess!', guessed: true });
        return true;
    }

    if (guessHistory.length >= MAX_GUESSES) {
        ucpopup = createUnclosablePopup(
            "You didn't get today's BanG Dream! Our Notes character. Better luck tomorrow!",
            { title: 'Nice Try!', guessed: false });
    }
    return false;
}

// Function to handle the submitted input
function handleSubmit() {
    checkGuess(searchInput.value.trim());
}

// ---- Event listeners -----------------------------------------------------

searchInput.addEventListener('input', () => {
    showSuggestions(getSuggestions(searchInput.value));
    validateInput();
});

searchInput.addEventListener('focus', () => {
    showSuggestions(getSuggestions(searchInput.value));
    validateInput();
});

submitBtn.addEventListener('click', handleSubmit);

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

document.addEventListener('DOMContentLoaded', async function () {
    CharDict = await loadData();

    CharIndex = order[daysSinceStartDate() % order.length];
    Answer = CharDict[CharIndex];

    langSelect.value = lang;
    langSelect.addEventListener('change', () => {
        lang = langSelect.value;
        localStorage.setItem('lang', lang);
        buildGuesses();
        // Played rows carry names too, so they follow the language as well.
        renderBoard();
        searchInput.value = '';
        validateInput();
        suggestionsContainer.style.display = 'none';
    });

    buildGuesses();
    renderBoard();
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

// ---- Confetti ------------------------------------------------------------

// Brand pink plus the two lighter tints already used around the page, so the
// burst reads as part of the game rather than as generic party colours.
const CONFETTI_COLOURS = ['#de1c4e', '#b5133e', '#8f3a51', '#ffffff', '#ffc2d1'];
const CONFETTI_COUNT = 160;
const CONFETTI_SECONDS = 4;

// Hand-rolled rather than pulled from a confetti library: this is the only
// animation on the page, and a canvas plus a gravity loop is smaller than the
// dependency would be.
function launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // Above the end-of-round popup (9999), and transparent to clicks so the
    // share and endless buttons underneath stay usable.
    canvas.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10000;
    `;
    document.body.appendChild(canvas);
    const context = canvas.getContext('2d');

    // Pieces start above the top edge so the first frame is already a fall
    // rather than a flash of confetti sitting on the title.
    const pieces = Array.from({ length: CONFETTI_COUNT }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * -canvas.height,
        width: 6 + Math.random() * 6,
        height: 8 + Math.random() * 8,
        drift: -1.5 + Math.random() * 3,
        fall: 2 + Math.random() * 3,
        spin: -0.2 + Math.random() * 0.4,
        angle: Math.random() * Math.PI * 2,
        colour: CONFETTI_COLOURS[Math.floor(Math.random() * CONFETTI_COLOURS.length)],
    }));

    const start = performance.now();

    function frame(now) {
        const elapsed = (now - start) / 1000;
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Fade the whole burst out over the last second instead of cutting it.
        context.globalAlpha = Math.max(0, Math.min(1, CONFETTI_SECONDS - elapsed));

        for (const piece of pieces) {
            piece.x += piece.drift;
            piece.y += piece.fall;
            piece.angle += piece.spin;
            if (piece.y > canvas.height) {
                piece.y = -piece.height;
                piece.x = Math.random() * canvas.width;
            }

            context.save();
            context.translate(piece.x, piece.y);
            context.rotate(piece.angle);
            context.fillStyle = piece.colour;
            context.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
            context.restore();
        }

        if (elapsed < CONFETTI_SECONDS) {
            requestAnimationFrame(frame);
        } else {
            canvas.remove();
        }
    }

    requestAnimationFrame(frame);
}

// ---- End-of-round popup --------------------------------------------------

function createUnclosablePopup(content, options = {}) {
    // Set default options
    const config = {
        title: options.title || 'Important Notice',
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

    const stage = Answer.stageName ? ` &mdash; ${Answer.stageName}` : '';

    // Only celebrated on a win: the banner explains the confetti, so showing
    // it after a loss would promise a burst that never comes.
    const birthday = options.guessed && inBirthdayWindow(Answer);
    const elapsed = birthday ? daysSinceBirthday(Answer.birthday) : -1;
    const birthdayBanner = birthday
        ? `<p id="birthday-note">\u{1F382} ${elapsed === 0
            ? `It is ${Answer.names.en}'s birthday today!`
            : `${Answer.names.en}'s birthday was ${elapsed} day${elapsed === 1 ? '' : 's'} ago.`}</p>`
        : '';

    popup.innerHTML = `
                <h4 id="end-result"> ${config.title} </h4>
                <img id="answer-icon" src="${DATA}${Answer.icon}" alt="${Answer.names.en}">
                <p>The answer was <strong>${Answer.names.en} (${Answer.names.ja})</strong>${stage}<br>
                   ${Answer.band} &middot; ${Answer.positions.join(', ')}</p>
                <p id="tries-used">${content}</p>
                ${birthdayBanner}
                <button id="share-btn"> 
                    SHARE 
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-share" viewBox="0 0 16 16">
                      <path d="M13.5 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M11 2.5a2.5 2.5 0 1 1 .603 1.628l-6.718 3.12a2.5 2.5 0 0 1 0 1.504l6.718 3.12a2.5 2.5 0 1 1-.488.876l-6.718-3.12a2.5 2.5 0 1 1 0-3.256l6.718-3.12A2.5 2.5 0 0 1 11 2.5m-8.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m11 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"/>
                    </svg>
                </button>
                <div id="status"></div>
                <p class="description">Time until the next character: </p>
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

    if (birthday) {
        launchConfetti();
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
        CharIndex = getRandomInt(0, CharDict.length - 1);
        Answer = CharDict[CharIndex];

        // clear the board
        guessHistory = [];
        renderBoard();

        searchInput.value = '';
        validateInput();

        mode = "Endless";

        // Close the popup
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
    const formattedDate = formatDateUTC(new Date());

    // The daily answer is the same for everyone, so it is never spoiled here.
    // An endless round is private, so naming the character is the only way the
    // score means anything.
    const answer = mode === "Endless" ? `\n\n Character: ${Answer.names.en}` : '';

    return `BanG Dream! Our Notes ${mode} Wordle #${CharIndex}, ${formattedDate} (UTC) ${answer}

${generateGuessNumbers(isGuessed)}`;
}

function generateGuessNumbers(isGuessed) {
    const right = "🟩";
    const wrong = "⬛️";
    const unused = "⬜️";

    let emojis = "";
    for (let i = 0; i < guessHistory.length; i++) {
        // The final entry is the winning guess when the round was solved.
        emojis += (isGuessed && i === guessHistory.length - 1) ? right : wrong;
    }
    for (let i = guessHistory.length; i < MAX_GUESSES; i++) {
        emojis += unused;
    }
    return emojis;
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
