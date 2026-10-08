'use strict';

// Datasets are shared between the games and always addressed from data/, never
// from this folder, so the same cards.json can back a second game later.
const DATA = '../data/';

const SIZE = 3;
const LIVES = 3;

// Every square is guaranteed at least this many cards that fit. One would make
// a square a single forced card out of 63, which against three lives is a
// guess rather than a deduction.
const MIN_PER_CELL = 2;

// A grid is six clues drawn at random; this is how many draws are made before
// giving up. Measured over the current 63 cards a usable grid turns up after
// about 100 draws and the worst case seen was 1012, so this is slack, not a
// tuning knob.
const MAX_ATTEMPTS = 3000;

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
        valuesOf: card => [card.rarityLabel],
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

// The ids of those cards. Walking the smaller set keeps this cheap: a draw
// calls it nine times and a grid can take hundreds of draws.
function idsFor(rowClue, columnClue) {
    const [small, large] = rowClue.ids.size <= columnClue.ids.size
        ? [rowClue.ids, columnClue.ids]
        : [columnClue.ids, rowClue.ids];
    const found = [];
    for (const id of small) {
        if (large.has(id)) found.push(id);
    }
    return found;
}

/* Can the nine squares be filled with nine different cards at once?

   Checking each square separately is not enough. Three squares can each offer
   two cards and still have only two cards between them, and because a card is
   used once that grid can never be finished: the player would spend lives on a
   square that has nothing left to put in it. About one grid in eighty looks
   fine square by square and fails here.

   This is a bipartite matching between squares and cards, so each square in
   turn claims a card, pushing an earlier square onto another of its options
   when it has to. A square that cannot be served even after that reshuffling
   is one the grid has no room for. */
function canFillDistinctly(options) {
    const holder = new Map();
    function claim(square, tried) {
        for (const id of options[square]) {
            if (tried.has(id)) continue;
            tried.add(id);
            if (!holder.has(id) || claim(holder.get(id), tried)) {
                holder.set(id, square);
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

        const options = [];
        for (const row of rows) {
            for (const column of columns) {
                const ids = idsFor(row, column);
                if (ids.length < MIN_PER_CELL) break;
                options.push(ids);
            }
        }
        if (options.length < 9) continue;
        if (canFillDistinctly(options)) return { rows, columns };
    }
    return null;
}

// ---- State ---------------------------------------------------------------

let CARDS = [];
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

function loadState() {
    if (mode !== 'daily') return emptyState();
    try {
        const saved = JSON.parse(localStorage.getItem(dailyKey()));
        // Guard the shape: a half-written or older entry must not wedge the board.
        if (saved
            && Array.isArray(saved.placed) && saved.placed.length === SIZE
            && Array.isArray(saved.missed) && saved.missed.length === SIZE
            && typeof saved.lives === 'number') {
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

/* Cards already placed are gone from the pool: reusing one would let a single
   card cover several squares, which is not a puzzle. A card rejected somewhere
   is still free, since it may well belong on another square. */
function usedIds() {
    return new Set(state.placed.flat().filter(id => id !== null));
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

   Two sets are held back. Cards already placed, because one card may not cover
   two squares. And the cards this square has already rejected, because a life
   has been paid to learn they do not belong here and charging a second one for
   the same answer is a trap, not a difficulty. */
function candidates() {
    const used = usedIds();
    const rejected = new Set(state.missed[selected.row][selected.column]);
    return CARDS.filter(card => !used.has(card.id) && !rejected.has(card.id));
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
        sub.textContent = `${card.rarityLabel} \u00b7 ${card.character} \u00b7 ${card.band}`;
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
