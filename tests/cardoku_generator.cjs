/* Self-check for the cardoku board enumeration against the committed dataset.
 *
 * Boards are enumerated rather than sampled, and the daily walks that list
 * with a step coprime to its length. Two things have to hold for that to be
 * worth the 180ms it costs: every enumerated board has to be a fair puzzle,
 * and the walk has to be a genuine permutation, or the no-repeat guarantee is
 * just a slower version of the sampler it replaced.
 *
 * main.js is a plain script that touches the DOM only inside functions, so it
 * is loaded verbatim with stubs for the globals its top level registers
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

const source = fs.readFileSync(path.join(ROOT, 'cardoku/js/main.js'), 'utf8');
const epilogue = `
    exported.buildClues = buildClues;
    exported.charactersFor = charactersFor;
    exported.enumerateBoards = enumerateBoards;
    exported.cluePool = cluePool;
    exported.boardList = boardList;
    exported.boardAt = boardAt;
    exported.cycleStep = cycleStep;
    exported.dayNumber = dayNumber;
    exported.MIN_CHARACTERS_PER_CELL = MIN_CHARACTERS_PER_CELL;
    exported.CATEGORIES = CATEGORIES;
    exported.saveState = () => saveState();
    exported.loadState = () => loadState();
    exported.emptyState = () => emptyState();
    exported.play = (p, s) => { puzzle = p; mode = 'daily'; state = s; };
    exported.load = cards => {
        CARDS = cards;
        CHARACTER_OF = new Map(cards.map(card => [card.id, card.characterId]));
    };
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

const cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/cards/cards.json'), 'utf8'));
exported.load(cards);

// Every category has to contribute clues, otherwise a field was renamed in the
// dataset and the game silently lost an axis.
const pool = exported.cluePool();
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

/* A board is only honest if the nine squares can be filled with nine different
   characters at once. Re-derived here from the clue index triples, so the
   check does not trust the enumeration's own bookkeeping. */
function solvable(rows, columns) {
    const options = [];
    for (const row of rows) {
        for (const column of columns) {
            const characters = exported.charactersFor(pool[row], pool[column]);
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

const boards = exported.boardList();
assert.ok(boards.length > 0, 'no boards were enumerated at all');

const categoriesSeen = new Set();
const canonical = new Set();
for (let index = 0; index < boards.length; index++) {
    const { rows, columns } = boards[index];
    assert.ok(solvable(rows, columns), `board ${index} cannot be filled with nine characters`);

    // Six clues, six different categories. Across the axes a repeat is an
    // unfillable square; down one axis it is the same question asked twice.
    const used = [...rows, ...columns].map(i => pool[i].category);
    assert.strictEqual(new Set(used).size, 6, `board ${index} repeats a category`);
    for (const category of used) categoriesSeen.add(category);

    /* A board and its transpose are the same puzzle. If both were listed, the
       cycle would serve a player the same grid twice, flipped, and still call
       the guarantee kept. */
    const key = [rows.join(','), columns.join(',')].sort().join(' x ');
    assert.ok(!canonical.has(key), `board ${index} is the transpose of an earlier one`);
    canonical.add(key);
}
assert.strictEqual(
    categoriesSeen.size,
    exported.CATEGORIES.length,
    `only ${[...categoriesSeen].join(', ')} ever reach a board`
);

/* The whole point: walking the list by a coprime step visits every board once
   before it visits any board twice. Checked over a full cycle, not sampled. */
const step = exported.cycleStep(boards.length);
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
assert.strictEqual(gcd(step, boards.length), 1, `step ${step} does not generate the full cycle`);

const visited = new Uint8Array(boards.length);
for (let day = 0; day < boards.length; day++) {
    const index = (day * step) % boards.length;
    assert.strictEqual(visited[index], 0, `board ${index} came up twice within one cycle, on day ${day}`);
    visited[index] = 1;
}
assert.ok(visited.every(seen => seen === 1), 'the cycle never reached some boards');

/* Orientation is cosmetic. Two different seeds may lay the same board out
   differently, but they have to be the same six clues: otherwise the cycle is
   not walking the list it thinks it is. */
const labelsOf = puzzle => [...puzzle.rows, ...puzzle.columns].map(clue => clue.label).sort().join('|');
for (const index of [0, 1, 7, boards.length - 1]) {
    const expected = [...boards[index].rows, ...boards[index].columns]
        .map(i => pool[i].label).sort().join('|');
    for (const seed of [0, 12345, 0xdeadbeef]) {
        assert.strictEqual(
            labelsOf(exported.boardAt(index, seed)),
            expected,
            `boardAt(${index}, ${seed}) served a different board`
        );
    }
}

// An index outside the list has to wrap rather than hand back nothing: the
// daily multiplies the day number by the step and never reduces it first.
assert.ok(exported.boardAt(boards.length * 3 + 2, 1).rows.length === 3, 'an out-of-range index did not wrap');

/* A saved daily board is replayed onto a grid rebuilt from the card data, so
   a dataset refresh or a change to the enumeration can hand the same day a
   different grid. The save is stamped with a fingerprint of the grid it was
   played on, and a board that does not match has to be dropped: replaying it
   would show placed cards as correct under clues they do not satisfy, and
   would carry over lives spent on a grid that no longer exists. */
const gridA = exported.boardAt(0, 0);
const gridB = exported.boardAt(1, 0);

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
    columns: gridA.columns,
};
shifted.rows[0].ids.delete([...shifted.rows[0].ids][0]);
exported.play(shifted, played);
assert.deepStrictEqual(
    exported.loadState(),
    exported.emptyState(),
    'a save survived a clue that accepts a different set of cards'
);

const years = (boards.length / 365.2425).toFixed(1);
console.log(`${cards.length} cards, ${pool.length} clues, ${boards.length} boards`);
console.log(`  clues per category: ${[...byCategory].map(([c, n]) => `${c} ${n}`).join(', ')}`);
console.log(`  cycle step ${step}: every board once in ${boards.length} days (${years} years)`);
