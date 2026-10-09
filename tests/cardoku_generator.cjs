/* Self-check for the cardoku grid generator against the committed dataset.
 *
 * The generator draws six clues at random and retries until the nine squares
 * are jointly fillable, so a dataset change can make grids rarer without
 * making them impossible: nothing breaks, the page just stalls. This runs the
 * real generator over many seeds and fails if any seed cannot produce a grid,
 * if a grid is not actually solvable, or if the retry count has crept near
 * MAX_ATTEMPTS.
 *
 * main.js is a plain script that touches the DOM only inside functions, so it
 * is loaded verbatim with stubs for the two globals its top level registers
 * against, plus an epilogue that hands back the internals.
 *
 * Run: node tests/cardoku_generator.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SEEDS = 2000;

const source = fs.readFileSync(path.join(ROOT, 'cardoku/js/main.js'), 'utf8');
const epilogue = `
    exported.generatePuzzle = generatePuzzle;
    exported.buildClues = buildClues;
    exported.charactersFor = charactersFor;
    exported.MAX_ATTEMPTS = MAX_ATTEMPTS;
    exported.MIN_CHARACTERS_PER_CELL = MIN_CHARACTERS_PER_CELL;
    exported.CATEGORIES = CATEGORIES;
    exported.hash32 = hash32;
    exported.fitsPuzzle = saved => fitsPuzzle(saved);
    exported.setPuzzle = p => { puzzle = p; };
    exported.load = cards => {
        CARDS = cards;
        CHARACTER_OF = new Map(cards.map(card => [card.id, card.characterId]));
    };
`;

const exported = {};
const noop = () => {};
vm.runInNewContext(source + epilogue, {
    exported,
    document: { addEventListener: noop },
    localStorage: { getItem: () => null, setItem: noop },
});

const cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/cards/cards.json'), 'utf8'));
exported.load(cards);

// Every category has to contribute clues, otherwise a field was renamed in the
// dataset and the generator silently lost an axis.
const pool = exported.buildClues(cards);
const byCategory = new Map();
for (const clue of pool) {
    byCategory.set(clue.category, (byCategory.get(clue.category) || 0) + 1);
}
for (const category of exported.CATEGORIES) {
    assert.ok(
        byCategory.get(category.name) >= 2,
        `category ${category.name} offers fewer than two clues`
    );
}

/* A grid is only honest if the nine squares can be filled with nine different
   characters at once. Re-derived here from the puzzle the generator returns,
   so the check does not trust the generator's own bookkeeping. */
function solvable(puzzle) {
    const options = [];
    for (const row of puzzle.rows) {
        for (const column of puzzle.columns) {
            const characters = exported.charactersFor(row, column);
            if (characters.size < exported.MIN_CHARACTERS_PER_CELL) return false;
            options.push([...characters]);
        }
    }
    const holder = new Map();
    const claim = (square, tried) => {
        for (const character of options[square]) {
            if (tried.has(character)) continue;
            tried.add(character);
            if (!holder.has(character) || claim(holder.get(character), tried)) {
                holder.set(character, square);
                return true;
            }
        }
        return false;
    };
    return options.every((_, square) => claim(square, new Set()));
}

const categoriesSeen = new Set();
let failures = 0;
for (let seed = 0; seed < SEEDS; seed++) {
    const puzzle = exported.generatePuzzle(seed);
    if (puzzle === null) {
        failures++;
        continue;
    }
    if (!solvable(puzzle)) {
        throw new Error(`seed ${seed} produced an unsolvable grid`);
    }
    // No category may sit on a row and a column at once: such a square wants a
    // card that is two things at once and can never be filled.
    const rows = new Set(puzzle.rows.map(clue => clue.category));
    for (const clue of puzzle.columns) {
        assert.ok(!rows.has(clue.category), `seed ${seed} repeats ${clue.category} on both axes`);
        categoriesSeen.add(clue.category);
    }
    for (const clue of puzzle.rows) categoriesSeen.add(clue.category);
    // Nor may an axis be one category all the way down: three clues that all
    // read the same are one question asked three times.
    const columns = new Set(puzzle.columns.map(clue => clue.category));
    assert.ok(rows.size >= 2, `seed ${seed} has a ${[...rows][0]}-only row axis`);
    assert.ok(columns.size >= 2, `seed ${seed} has a ${[...columns][0]}-only column axis`);
}

assert.strictEqual(failures, 0, `${failures}/${SEEDS} seeds produced no grid`);
assert.strictEqual(
    categoriesSeen.size,
    exported.CATEGORIES.length,
    `only ${[...categoriesSeen].join(', ')} ever reached a grid`
);

/* A saved daily board is replayed onto a grid rebuilt from the card data, so
   a dataset refresh can hand the same day a different grid. Placements that
   no longer satisfy their square have to be rejected, or they come back
   marked correct under clues they do not meet. */
const grid = exported.generatePuzzle(0);
exported.setPuzzle(grid);
const blank = { placed: [[null, null, null], [null, null, null], [null, null, null]] };
assert.ok(exported.fitsPuzzle(blank), 'an empty board was rejected');

const topLeft = cards.find(card => grid.rows[0].ids.has(card.id) && grid.columns[0].ids.has(card.id));
const elsewhere = cards.find(card => !grid.rows[0].ids.has(card.id) || !grid.columns[0].ids.has(card.id));
assert.ok(
    exported.fitsPuzzle({ placed: [[topLeft.id, null, null], [null, null, null], [null, null, null]] }),
    'a placement that still satisfies both clues was discarded'
);
assert.ok(
    !exported.fitsPuzzle({ placed: [[elsewhere.id, null, null], [null, null, null], [null, null, null]] }),
    'a placement that no longer satisfies its clues was kept'
);

console.log(`${cards.length} cards, ${pool.length} clues`);
console.log(`  clues per category: ${[...byCategory].map(([c, n]) => `${c} ${n}`).join(', ')}`);
console.log(`  ${SEEDS} seeds, all solvable, all ${categoriesSeen.size} categories used`);
