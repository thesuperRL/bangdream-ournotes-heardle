'use strict';

// Datasets are shared between the games and always addressed from data/, never
// from this folder, so the same cards.json can back a second game later.
const DATA = '../data/';

const SIZE = 3;
const LIVES = 3;

/* Every square is guaranteed at least this many different characters that fit.
   Characters, not cards, because a grid holds each character once: two cards
   of one character are a single answer as far as the grid is concerned, and a
   square down to one character is forced rather than deduced. */
const MIN_CHARACTERS_PER_CELL = 2;

// A grid is six clues drawn at random; this is how many draws are made before
// giving up. Measured over the current 66 cards a usable grid turns up after
// about 196 draws and the worst case seen in 3000 runs was 1473, so this is
// slack, not a tuning knob. See tests/cardoku_generator.cjs.
const MAX_ATTEMPTS = 20000;

// ---- Randomness ----------------------------------------------------------

// Same seed, same grid: that is what lets the daily puzzle be identical for
// everyone without a server handing it out.
function mulberry32(seed) {
    return function () {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hash32(text) {
    let hash = 0;
    for (const character of text) {
        hash = (Math.imul(31, hash) + character.charCodeAt(0)) | 0;
    }
    return hash >>> 0;
}

// UTC so the day rolls over at the same instant everywhere.
function todayStamp() {
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${now.getUTCFullYear()}-${month}-${day}`;
}

// ---- Clues ---------------------------------------------------------------

// Attribute gem colours as they appear in game: Ruby red, Azure blue, Jade
// green, Amber yellow, Violet purple. Darkened so white chip text stays legible.
const ATTRIBUTE_COLOURS = {
    Ruby: '#a6263c',
    Azure: '#2a5a9e',
    Jade: '#2d7a44',
    Amber: '#8a6a1c',
    Violet: '#6a3090',
};

const CATEGORY_COLOURS = {
    position: '#3a5a7a',
    rarity: '#6a3a8a',
    school: '#2a5a4a',
    year: '#3a3a7a',
    skill: '#8a3a6a',
};

// How a clue reads a card. A card has several positions, so `position` tests
// membership while the rest compare a single value.
const CATEGORIES = [
    {
        name: 'band',
        valuesOf: card => [card.band],
        label: value => value,
        // Each band already has an official colour in the dataset.
        colour: (value, card) => card.bandColor,
    },
    {
        name: 'position',
        valuesOf: card => card.positions,
        label: value => value,
        colour: () => CATEGORY_COLOURS.position,
    },
    {
        name: 'rarity',
        // Spelled out rather than R/SR/SSR: a clue has to be readable by
        // someone who has not memorised the game's initials.
        valuesOf: card => [card.rarityName],
        label: value => value,
        colour: () => CATEGORY_COLOURS.rarity,
    },
    {
        name: 'attribute',
        valuesOf: card => [card.attributeLabel],
        label: value => `${value} Type`,
        colour: value => ATTRIBUTE_COLOURS[value],
    },
    {
        name: 'school',
        valuesOf: card => [card.school],
        label: value => value,
        colour: () => CATEGORY_COLOURS.school,
    },
    {
        name: 'year',
        valuesOf: card => [card.yearLabel],
        label: value => value,
        colour: () => CATEGORY_COLOURS.year,
    },
    {
        name: 'skill',
        // The family the game prints in brackets at the head of the card's
        // live skill text: Simple, Hit or Life.
        valuesOf: card => [card.liveSkill],
        label: value => `${value} Skill`,
        colour: () => CATEGORY_COLOURS.skill,
    },
];

/* Turn the cards into the full list of clues that could appear on the grid.
   Each clue carries the set of card ids it accepts, so testing a square later
   is two set lookups instead of re-reading the card. */
function buildClues(cards) {
    const clues = [];
    for (const category of CATEGORIES) {
        const byValue = new Map();
        for (const card of cards) {
            for (const value of category.valuesOf(card)) {
                if (!byValue.has(value)) {
                    byValue.set(value, { ids: new Set(), first: card });
                }
                byValue.get(value).ids.add(card.id);
            }
        }
        for (const [value, group] of byValue) {
            clues.push({
                category: category.name,
                value: value,
                label: category.label(value),
                colour: category.colour(value, group.first),
                ids: group.ids,
            });
        }
    }
    return clues;
}

// The cards that satisfy both of a square's clues.
function cardsFor(rowClue, columnClue) {
    return CARDS.filter(card => rowClue.ids.has(card.id) && columnClue.ids.has(card.id));
}

/* The distinct characters a square can be filled by.

   The intersection has to be taken over cards and only then collapsed to
   characters. Going straight to characters would accept a character who meets
   the row clue on one card and the column clue on a different one, which is
   not a card that can be put in the square. */
function charactersFor(rowClue, columnClue) {
    const [small, large] = rowClue.ids.size <= columnClue.ids.size
        ? [rowClue.ids, columnClue.ids]
        : [columnClue.ids, rowClue.ids];
    const found = new Set();
    for (const id of small) {
        if (large.has(id)) found.add(CHARACTER_OF.get(id));
    }
    return found;
}

/* Can the nine squares be filled all at once, given that a character is used
   only once in a grid?

   Checking each square on its own is not enough. Three squares can each offer
   two characters and still have only two characters between them, and that
   grid can never be finished: the player would reach a square with nobody left
   to put in it. About one grid in eighty looks fine square by square and fails
   here.

   This is a bipartite matching between squares and characters, so each square
   in turn claims a character, pushing an earlier square onto another of its
   options when it has to. A square that cannot be served even after that
   reshuffling is one the grid has no room for. */
function canFillDistinctly(options) {
    const holder = new Map();
    function claim(square, tried) {
        for (const character of options[square]) {
            if (tried.has(character)) continue;
            tried.add(character);
            if (!holder.has(character) || claim(holder.get(character), tried)) {
                holder.set(character, square);
                return true;
            }
        }
        return false;
    }
    return options.every((_, square) => claim(square, new Set()));
}

/* Draw three row clues and three column clues that leave every square
   fillable. Returns null only if the card data has changed so much that no
   such grid exists, which the caller reports rather than hiding. */
function generatePuzzle(seed) {
    const random = mulberry32(seed);
    const pool = buildClues(CARDS);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // Partial Fisher-Yates: only the six clues actually needed are drawn.
        const drawn = [...pool];
        for (let i = 0; i < 6; i++) {
            const j = i + Math.floor(random() * (drawn.length - i));
            [drawn[i], drawn[j]] = [drawn[j], drawn[i]];
        }
        const rows = drawn.slice(0, 3);
        const columns = drawn.slice(3, 6);

        /* A category may repeat down one axis but never across both. Band on a
           row and band on a column can only ever meet in a card that is in two
           bands at once, so such a square has no answer at all. */
        const rowCategories = new Set(rows.map(clue => clue.category));
        if (columns.some(clue => rowCategories.has(clue.category))) continue;

        /* An axis may not be one category all the way down either. Such a grid
           is solvable and legal, but all three clues read the same and the
           axis stops feeling like three separate questions. It is not rare
           enough to ignore: the retry loop below prefers broad clues, which
           pushes small categories like rarity and skill up to roughly one grid
           in a hundred with a single-category axis, against one in seven
           thousand if the six clues were simply drawn and kept. */
        const columnCategories = new Set(columns.map(clue => clue.category));
        if (rowCategories.size < 2 || columnCategories.size < 2) continue;

        const options = [];
        for (const row of rows) {
            for (const column of columns) {
                const characters = charactersFor(row, column);
                if (characters.size < MIN_CHARACTERS_PER_CELL) break;
                options.push(characters);
            }
        }
        if (options.length < 9) continue;
        if (canFillDistinctly(options)) return { rows, columns };
    }
    return null;
}

// ---- State ---------------------------------------------------------------

let CARDS = [];
// Card id -> character slug, so the generator can collapse a square's cards to
// the characters behind them without searching CARDS each time.
let CHARACTER_OF = new Map();
let puzzle = null;
/* placed[row][column] is the card that settled the square, or null while it is
   still open. missed[row][column] lists the cards already tried there and
   rejected: they cost a life each, the last of them is what the square shows
   while it stays open, and none of them is offered for that square again. */
let state = null;
let mode = 'daily';
let over = false;
let selected = null;

function dailyKey() {
    return `cardoku-daily-${todayStamp()}`;
}

function emptyState() {
    return {
        placed: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
        missed: Array.from({ length: SIZE }, () => [[], [], []]),
        lives: LIVES,
    };
}

// What a square shows: the card that settled it, else the last card rejected
// there, else nothing.
function shownCard(row, column) {
    if (state.placed[row][column] !== null) return state.placed[row][column];
    const tried = state.missed[row][column];
    return tried.length > 0 ? tried[tried.length - 1] : null;
}

function isOver() {
    return state.lives <= 0 || solvedCount() === SIZE * SIZE;
}

function solvedCount() {
    return state.placed.flat().filter(id => id !== null).length;
}

// Only the daily grid is worth restoring: an unlimited grid is one of millions
// and is meant to be thrown away.
function saveState() {
    if (mode !== 'daily') return;
    try {
        localStorage.setItem(dailyKey(), JSON.stringify(state));
    } catch (error) {
        /* Private browsing refuses storage; the game still plays. */
    }
}

/* Does a restored board still belong to the grid on screen?

   The daily grid is derived from the card data and the generator, so a
   dataset refresh or a change to the drawing rules silently gives the same
   day a different grid. The old save would then be replayed onto it and every
   placed card would show as correct under clues it does not satisfy. Checking
   the placements is cheaper than versioning the save, and it fails the only
   way that is safe: the day starts over. */
function fitsPuzzle(saved) {
    for (let row = 0; row < SIZE; row++) {
        for (let column = 0; column < SIZE; column++) {
            const id = saved.placed[row][column];
            if (id === null) continue;
            if (!puzzle.rows[row].ids.has(id) || !puzzle.columns[column].ids.has(id)) {
                return false;
            }
        }
    }
    return true;
}

function loadState() {
    if (mode !== 'daily') return emptyState();
    try {
        const saved = JSON.parse(localStorage.getItem(dailyKey()));
        // Guard the shape: a half-written or older entry must not wedge the board.
        if (saved
            && Array.isArray(saved.placed) && saved.placed.length === SIZE
            && Array.isArray(saved.missed) && saved.missed.length === SIZE
            && typeof saved.lives === 'number') {
            if (!fitsPuzzle(saved)) return emptyState();
            return saved;
        }
    } catch (error) {
        /* Fall through to a fresh board. */
    }
    return emptyState();
}

// ---- Rendering -----------------------------------------------------------

function chipElement(clue) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.style.backgroundColor = clue.colour;
    chip.textContent = clue.label;
    return chip;
}

function cardById(id) {
    return CARDS.find(card => card.id === id);
}

function renderGrid() {
    const grid = document.getElementById('grid');
    grid.replaceChildren();

    if (!puzzle) {
        grid.textContent = 'Could not build a grid from the current card data.';
        grid.style.color = '#999999';
        return;
    }

    const corner = document.createElement('div');
    corner.className = 'grid-corner';
    grid.appendChild(corner);
    for (const column of puzzle.columns) {
        grid.appendChild(chipElement(column));
    }

    for (let row = 0; row < SIZE; row++) {
        grid.appendChild(chipElement(puzzle.rows[row]));

        for (let column = 0; column < SIZE; column++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = row;
            cell.dataset.column = column;

            const solved = state.placed[row][column] !== null;
            const id = shownCard(row, column);
            if (id !== null) {
                const card = cardById(id);
                const image = document.createElement('img');
                image.src = DATA + card.thumbnail;
                image.alt = `${card.title} — ${card.character}`;
                cell.appendChild(image);
                cell.classList.add(solved ? 'correct' : 'wrong');
            }

            // Only a solved square stops taking guesses. A square showing a
            // rejected card is still open, so it keeps its hover affordance.
            if (!over && solved) {
                cell.classList.add('locked');
            }
            cell.addEventListener('click', onCellClick);
            grid.appendChild(cell);
        }
    }
}

function renderLives() {
    const lives = document.getElementById('lives');
    lives.replaceChildren();
    for (let i = 0; i < LIVES; i++) {
        const heart = document.createElement('span');
        heart.className = i < state.lives ? 'heart' : 'heart spent';
        heart.textContent = '\u2665';
        lives.appendChild(heart);
    }
}

function renderControls() {
    document.getElementById('share-btn').disabled = !over;
    document.getElementById('mode-btn').textContent = mode === 'daily' ? 'Daily' : 'Unlimited';
    // The daily grid is the same for everyone all day, so there is nothing to
    // redeal until the mode changes.
    document.getElementById('new-btn').disabled = mode === 'daily';
}

function render() {
    renderGrid();
    renderLives();
    renderControls();
}

// ---- Playing -------------------------------------------------------------

function startGame(seed) {
    puzzle = generatePuzzle(seed);
    state = loadState();
    over = isOver();
    render();
}

function startDaily() {
    mode = 'daily';
    startGame(hash32(todayStamp()));
}

function startUnlimited() {
    mode = 'unlimited';
    startGame((Math.random() * 0x100000000) >>> 0);
}

function onCellClick(event) {
    const row = Number(event.currentTarget.dataset.row);
    const column = Number(event.currentTarget.dataset.column);

    if (over) {
        showAnswers(row, column);
        return;
    }
    // Only a solved square is closed; a rejected card can be guessed over.
    if (state.placed[row][column] !== null) return;

    selected = { row: row, column: column };
    openSearch();
}

/* The characters already standing in the grid. A grid holds each character
   once, so once one of their cards is placed the rest of that character's
   cards leave the pool everywhere; which of their cards the player used is up
   to them. A character merely rejected somewhere is still free. */
function usedCharacters() {
    const used = new Set();
    for (const id of state.placed.flat()) {
        if (id !== null) used.add(CHARACTER_OF.get(id));
    }
    return used;
}

function commitGuess(id) {
    if (!selected || over) return;
    // Read the square before closing: closing clears the selection.
    const { row, column } = selected;
    document.getElementById('search-dialog').close();

    const correct = cardsFor(puzzle.rows[row], puzzle.columns[column])
        .some(card => card.id === id);

    if (correct) {
        state.placed[row][column] = id;
    } else {
        state.missed[row][column].push(id);
        state.lives--;
    }

    over = isOver();
    saveState();
    render();

    const cell = document.querySelector(`.cell[data-row="${row}"][data-column="${column}"]`);
    if (cell) {
        cell.classList.add(correct ? 'flash-correct' : 'flash-wrong');
    }

    if (over) {
        // Let the flash land before the popup covers the board.
        setTimeout(showEnd, 900);
    }
}

// ---- Search dialog -------------------------------------------------------

const MAX_SUGGESTIONS = 8;

function searchKey(text) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function openSearch() {
    const { row, column } = selected;
    document.getElementById('search-title').innerHTML =
        `<b>${puzzle.rows[row].label}</b> and <b>${puzzle.columns[column].label}</b>`;
    const input = document.getElementById('search-input');
    input.value = '';
    renderSuggestions('');
    document.getElementById('search-dialog').showModal();
    input.focus();
}

/* Every card is offered, not just the ones that fit. Narrowing the list to the
   cards that already satisfy both clues would answer the puzzle for the player
   and leave the three lives unspendable.

   Two sets are held back. Every card of a character already in the grid, since
   a character fills one square and no more. And the cards this square has
   already rejected, which is a card-level list rather than a character one: a
   character's cards differ in rarity and attribute, so the wrong card of a
   character can sit beside the right one. */
function candidates() {
    const used = usedCharacters();
    const rejected = new Set(state.missed[selected.row][selected.column]);
    return CARDS.filter(card =>
        !used.has(card.characterId) && !rejected.has(card.id));
}

function renderSuggestions(query) {
    const container = document.getElementById('suggestions');
    container.replaceChildren();
    if (!selected) return;

    const key = searchKey(query);
    const matches = candidates().filter(card => !key
        || searchKey(card.title).includes(key)
        || searchKey(card.character).includes(key)
        || (card.stageName && searchKey(card.stageName).includes(key)));

    if (matches.length === 0) {
        const note = document.createElement('p');
        note.className = 'empty-note';
        note.textContent = 'No card matches that search.';
        container.appendChild(note);
        return;
    }

    for (const card of matches.slice(0, MAX_SUGGESTIONS)) {
        const item = document.createElement('div');
        item.className = 'suggestion';

        const image = document.createElement('img');
        image.src = DATA + card.thumbnail;
        image.alt = '';
        image.loading = 'lazy';

        const text = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'suggestion-name';
        name.textContent = card.title;
        const sub = document.createElement('div');
        sub.className = 'suggestion-sub';
        // Character only. The rarity and attribute of a card are what the
        // player is being asked to know, so printing them here would answer
        // the clue instead of posing it.
        sub.textContent = card.stageName
            ? `${card.character} (${card.stageName})`
            : card.character;
        text.append(name, sub);

        item.append(image, text);
        item.addEventListener('click', () => commitGuess(card.id));
        container.appendChild(item);
    }
}

function moveHighlight(step) {
    const items = [...document.querySelectorAll('.suggestion')];
    if (items.length === 0) return;
    const current = items.findIndex(item => item.classList.contains('active'));
    const next = (current + step + items.length) % items.length;
    items.forEach(item => item.classList.remove('active'));
    items[next].classList.add('active');
    items[next].scrollIntoView({ block: 'nearest' });
}

// ---- Answers (after the game) --------------------------------------------

function showAnswers(row, column) {
    const matches = cardsFor(puzzle.rows[row], puzzle.columns[column]);
    document.getElementById('answers-title').textContent =
        `${puzzle.rows[row].label} and ${puzzle.columns[column].label}`;

    const list = document.getElementById('answers-list');
    list.replaceChildren();
    for (const card of matches) {
        const item = document.createElement('div');
        item.className = 'answer';

        const image = document.createElement('img');
        image.src = DATA + card.thumbnail;
        image.alt = '';
        image.loading = 'lazy';

        const text = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'answer-name';
        name.textContent = card.title;
        const sub = document.createElement('div');
        sub.className = 'answer-sub';
        sub.textContent = `${card.rarityName} \u00b7 ${card.character} \u00b7 ${card.band}`;
        text.append(name, sub);

        item.append(image, text);
        list.appendChild(item);
    }
    document.getElementById('answers-dialog').showModal();
}

// ---- End popup and sharing -----------------------------------------------

function resultGrid() {
    const lines = [];
    for (let row = 0; row < SIZE; row++) {
        let line = '';
        for (let column = 0; column < SIZE; column++) {
            if (state.placed[row][column] !== null) line += '\u{1F7E9}';
            else if (state.missed[row][column].length > 0) line += '\u{1F7E5}';
            else line += '\u2B1B';
        }
        lines.push(line);
    }
    return lines.join('\n');
}

function shareText() {
    const parts = ['BanG Dream! Cardoku'];
    if (mode === 'daily') parts.push(todayStamp());
    parts.push(resultGrid());
    parts.push(`${solvedCount()}/9 with ${state.lives}/${LIVES} lives left`);
    parts.push('https://thesuperrl.github.io/bangdream-ournotes-heardle/cardoku/');
    return parts.join('\n');
}

function share() {
    const text = shareText();
    const button = document.getElementById('share-btn');
    navigator.clipboard.writeText(text).then(() => {
        button.textContent = 'Copied!';
        setTimeout(() => { button.textContent = 'Share'; }, 1500);
    }).catch(() => {
        button.textContent = 'Copy failed';
        setTimeout(() => { button.textContent = 'Share'; }, 1500);
    });
}

function showEnd() {
    // The popup is delayed, so a grid started in the meantime cancels it.
    if (!over) return;
    const won = solvedCount() === SIZE * SIZE;
    const popup = document.getElementById('endPopup');
    popup.replaceChildren();

    const heading = document.createElement('h4');
    heading.id = 'end-title';
    if (won) heading.classList.add('won');
    heading.textContent = won ? 'Perfect grid!' : 'Out of lives';

    const score = document.createElement('p');
    score.textContent = `${solvedCount()} of 9 squares filled`;

    const grid = document.createElement('div');
    grid.id = 'end-grid';
    grid.textContent = resultGrid();
    grid.style.whiteSpace = 'pre';

    const shareButton = document.createElement('button');
    shareButton.className = 'footer-btn';
    shareButton.textContent = 'Share';
    shareButton.addEventListener('click', share);

    const close = document.createElement('button');
    close.className = 'footer-btn';
    close.textContent = 'See the board';
    close.addEventListener('click', hideEnd);

    const hint = document.createElement('p');
    hint.id = 'end-hint';
    hint.textContent = 'Click any square to see every card that fitted there.';

    popup.append(heading, score, grid, shareButton, close, hint);
    document.getElementById('endOverlay').style.display = 'block';
    popup.style.display = 'block';
}

function hideEnd() {
    document.getElementById('endOverlay').style.display = 'none';
    document.getElementById('endPopup').style.display = 'none';
}

// ---- Wiring --------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async function () {
    const response = await fetch(DATA + 'cards/cards.json');
    CARDS = await response.json();
    CHARACTER_OF = new Map(CARDS.map(card => [card.id, card.characterId]));

    const searchDialog = document.getElementById('search-dialog');
    const input = document.getElementById('search-input');

    input.addEventListener('input', () => renderSuggestions(input.value));
    input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveHighlight(1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveHighlight(-1);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const target = document.querySelector('.suggestion.active')
                || document.querySelector('.suggestion');
            if (target) target.click();
        }
    });

    // A dialog's own backdrop is part of the dialog, so a click lands on the
    // element itself only when it missed the content.
    searchDialog.addEventListener('click', event => {
        if (event.target === searchDialog) searchDialog.close();
    });
    searchDialog.addEventListener('close', () => { selected = null; });

    const answersDialog = document.getElementById('answers-dialog');
    answersDialog.addEventListener('click', event => {
        if (event.target === answersDialog) answersDialog.close();
    });

    document.getElementById('mode-btn').addEventListener('click', () => {
        hideEnd();
        if (mode === 'daily') startUnlimited();
        else startDaily();
    });
    document.getElementById('new-btn').addEventListener('click', () => {
        hideEnd();
        startUnlimited();
    });
    document.getElementById('share-btn').addEventListener('click', share);
    document.getElementById('endOverlay').addEventListener('click', hideEnd);

    startDaily();
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
