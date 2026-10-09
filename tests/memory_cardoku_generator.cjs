/* Self-check for the memory cardoku grid generator against the committed
 * dataset.
 *
 * The generator draws six clues at random and retries until the nine squares
 * are jointly fillable, so a dataset change can make grids rarer without
 * making them impossible: nothing breaks, the page just stalls. The risk is
 * real here because the `features` clues are narrow, and the pruning that
 * keeps them from stalling the draw is itself a thing that can go too far.
 * This runs the real generator over many seeds and fails if any seed cannot
 * produce a grid, if a grid is not actually solvable, or if a category can
 * never reach a board.
 *
 * main.js is a plain script that touches the DOM only inside functions, so it
 * is loaded verbatim with stubs for the two globals its top level registers
 * against, plus an epilogue that hands back the internals.
 *
 * Run: node tests/memory_cardoku_generator.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SEEDS = 2000;

const source = fs.readFileSync(path.join(ROOT, 'memory-cardoku/js/main.js'), 'utf8');
const epilogue = `
    exported.generatePuzzle = generatePuzzle;
    exported.buildClues = buildClues;
    exported.cardsFor = cardsFor;
    exported.MIN_CARDS_PER_CELL = MIN_CARDS_PER_CELL;
    exported.CATEGORIES = CATEGORIES;
    exported.saveState = () => saveState();
    exported.loadState = () => loadState();
    exported.emptyState = () => emptyState();
    exported.play = (p, s) => { puzzle = p; mode = 'daily'; state = s; };
    exported.load = loaded => { CARDS = loaded; };
`;

const exported = {};
const noop = () => {};
const store = new Map();
vm.runInNewContext(source + epilogue, {
    exported,
    document: { addEventListener: noop },
    localStorage: {
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, value),
    },
});

const cards = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data/support-cards/support_cards.json'), 'utf8')
);
exported.load(cards);

// Every category has to contribute clues, otherwise a field was renamed in the
// dataset and the generator silently lost an axis.
const pool = exported.buildClues(cards);
const byCategory = new Map();
for (const clue of pool) {
    byCategory.set(clue.category, (byCategory.get(clue.category) || 0) + 1);
    assert.ok(clue.colour, `clue ${clue.label} has no chip colour`);
}
for (const category of exported.CATEGORIES) {
    assert.ok(
        byCategory.get(category.name) >= 2,
        `category ${category.name} offers fewer than two clues`
    );
}

/* A bipartite matching between squares and cards, written out here rather
   than borrowed from main.js so the check does not trust the generator's own
   bookkeeping. */
function matchable(options) {
    const holder = new Map();
    const claim = (square, tried) => {
        for (const id of options[square]) {
            if (tried.has(id)) continue;
            tried.add(id);
            if (!holder.has(id) || claim(holder.get(id), tried)) {
                holder.set(id, square);
                return true;
            }
        }
        return false;
    };
    return options.every((_, square) => claim(square, new Set()));
}

const categoriesSeen = new Set();
let failures = 0;
let thinnest = Infinity;
for (let seed = 0; seed < SEEDS; seed++) {
    const puzzle = exported.generatePuzzle(seed);
    if (puzzle === null) {
        failures++;
        continue;
    }

    /* Re-derived from the puzzle the generator returns, so the check does not
       trust the generator's own bookkeeping. A card sits in one square only,
       so nine squares with two cards each are not automatically fillable:
       three squares sharing the same two cards cannot all be served. */
    const options = [];
    for (const row of puzzle.rows) {
        for (const column of puzzle.columns) {
            const fits = exported.cardsFor(row, column);
            assert.ok(
                fits.length >= exported.MIN_CARDS_PER_CELL,
                `seed ${seed} left ${row.label} x ${column.label} with ${fits.length} cards`
            );
            thinnest = Math.min(thinnest, fits.length);
            options.push(fits.map(card => card.id));
        }
    }
    assert.ok(matchable(options), `seed ${seed} produced a grid that cannot be filled`);

    // A category may repeat down one axis but never across both, and no axis
    // may be one category all the way down.
    const rows = new Set(puzzle.rows.map(clue => clue.category));
    const columns = new Set(puzzle.columns.map(clue => clue.category));
    for (const clue of puzzle.columns) {
        assert.ok(!rows.has(clue.category), `seed ${seed} repeats ${clue.category} on both axes`);
    }
    assert.ok(rows.size >= 2, `seed ${seed} fills the rows with one category`);
    assert.ok(columns.size >= 2, `seed ${seed} fills the columns with one category`);
    for (const clue of [...puzzle.rows, ...puzzle.columns]) categoriesSeen.add(clue.category);
}

assert.strictEqual(failures, 0, `${failures}/${SEEDS} seeds produced no grid`);
assert.strictEqual(
    categoriesSeen.size,
    exported.CATEGORIES.length,
    `only ${[...categoriesSeen].join(', ')} ever reached a grid`
);

/* A saved daily board is replayed onto a grid rebuilt from the card data, so
   a dataset refresh or a change to the drawing rules can hand the same day a
   different grid. The stamp is what stops yesterday's placements being
   replayed onto today's clues, where they would show as correct under clues
   they do not satisfy. */
const gridA = exported.generatePuzzle(0);
const gridB = exported.generatePuzzle(1);

const played = exported.emptyState();
const topLeft = cards.find(card => gridA.rows[0].ids.has(card.id) && gridA.columns[0].ids.has(card.id));
played.placed[0][0] = topLeft.id;
played.lives = 2;

exported.play(gridA, played);
exported.saveState();
assert.strictEqual(
    exported.loadState().placed[0][0],
    topLeft.id,
    'a board saved and reloaded on the same grid did not come back'
);

exported.play(gridB, played);
assert.deepStrictEqual(
    exported.loadState(),
    exported.emptyState(),
    'a board saved on a different grid was replayed onto this one'
);

/* The same six clues with different cards behind them is still a different
   grid: a card whose attribute changed in the data leaves every label alone
   while changing what the clue accepts. */
const shifted = {
    rows: gridA.rows.map(clue => ({ ...clue, ids: new Set(clue.ids) })),
    columns: gridA.columns.map(clue => ({ ...clue, ids: new Set(clue.ids) })),
};
shifted.rows[0].ids.delete([...shifted.rows[0].ids][0]);
exported.play(shifted, played);
assert.deepStrictEqual(
    exported.loadState(),
    exported.emptyState(),
    'a save survived a clue that accepts a different set of cards'
);

console.log(`${cards.length} support cards, ${pool.length} clues`);
console.log(`  clues per category: ${[...byCategory].map(([c, n]) => `${c} ${n}`).join(', ')}`);
console.log(`  ${SEEDS} seeds, all filled, thinnest square ${thinnest} cards`);
console.log(`  categories reaching a board: ${[...categoriesSeen].join(', ')}`);
