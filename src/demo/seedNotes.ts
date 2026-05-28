import { abs2 } from '../geometry/complex';
import { gridIdToDiskPoint, type GridPoint } from '../grid/hyperbolicTiling';
import type { Note, NoteColor } from '../model/note';

const WORDS = [
  'Fireball',
  'Magic Missile',
  'Counterspell',
  'Wish',
  'Healing Word',
  'Eldritch Blast',
  'Polymorph',
  'Time Stop',
  'Meteor Swarm',
  'Shield',
  'Vicious Mockery',
  'Cure Wounds',
  'Banishment',
  'Misty Step',
  'Mage Hand',
  "Hunter's Mark",
  'Hex',
  'Bless',
  'Dispel Magic',
  'Hold Person',
  'Sleep',
  'Mass Suggestion',
  'Power Word Kill',
  'True Polymorph',
  'Disintegrate',
  'Paladin',
  'Wizard',
  'Sorcerer',
  'Rogue',
  'Bard',
  'Druid',
  'Fighter',
  'Cleric',
  'Warlock',
  'Ranger',
  'Monk',
  'Barbarian',
  'Artificer',
  'Tiefling',
  'Dragonborn',
  'Elf',
  'Halfling',
  'Dwarf',
  'Gnome',
  'Half-orc',
  'Aasimar',
  'Tabaxi',
  'Goliath',
  'Firbolg',
  'Genasi',
  'Beholder',
  'Mind Flayer',
  'Mimic',
  'Lich',
  'Tarrasque',
  'Owlbear',
  'Dire Wolf',
  'Goblin',
  'Bugbear',
  'Troll',
  'Displacer Beast',
  'Rust Monster',
  'Gelatinous Cube',
  'Ancient Red Dragon',
  'Vampire',
  'Banshee',
  'Wraith',
  'Pit Fiend',
  'Kobold',
  'Drow',
  'Githyanki',
  'Bag of Holding',
  'Vorpal Sword',
  'Ring of Protection',
  'Wand of Wonder',
  'Deck of Many Things',
  '+1 Longsword',
  'Cloak of Elvenkind',
  'Mithral Plate',
  'Healing Potion',
  'Scroll of Fireball',
  'Staff of Power',
  'Sending Stone',
  'Holy Avenger',
  'Boots of Speed',
  'Portable Hole',
  'Hat of Disguise',
  'Robe of the Archmagi',
  'Waterdeep',
  'Neverwinter',
  "Baldur's Gate",
  'Underdark',
  'Feywild',
  'Shadowfell',
  'Avernus',
  'Candlekeep',
  'Icewind Dale',
  'Barovia',
  'Sigil',
  'Menzoberranzan',
  'Ravenloft',
  'the Nine Hells',
  'the Astral Sea',
  'Initiative',
  'Saving Throw',
  'Nat 20!',
  'Nat 1',
  'Death Save',
  'Inspiration',
  'Sneak Attack',
  'Bonus Action',
  'Reaction',
  'Concentration',
  'Long Rest',
  'Short Rest',
  'Action Surge',
  'Rage',
  'Wild Shape',
  'Lay on Hands',
  'Bardic Inspiration',
  'Channel Divinity',
  'Smite',
  'STR 18',
  'DEX 14',
  'CON 16',
  'WIS 12',
  'CHA 8',
  'AC 18',
  'HP 47',
  'DC 15',
  '+7 to hit',
  '5d6 fire',
  'TPK',
  'Crit!',
  'Disadvantage',
  'Advantage',
  'Stealth check',
  'Persuasion',
  'Investigation',
  'Arcana',
  'Perception',
  'Athletics',
  'Acrobatics',
  'Sleight of Hand',
  'Insight',
  'session zero',
  'DM screen',
  'character sheet',
  'NPC',
  'BBEG',
  'lawful good',
  'chaotic evil',
  'true neutral',
  'chaotic good',
  'plot hook',
  'side quest',
  'random encounter',
  'main quest',
  'ambush!',
  'roll for initiative',
  'I attack the darkness',
  'cantrip',
  'ritual cast',
  'familiar',
  'metamagic',
  'multiclass',
  'subclass',
  'feat',
  'spell slot',
  'tavern brawl',
  'dungeon crawl',
  'boss fight',
  'mini-boss',
];

const COLORS: NoteColor[] = ['c1', 'c2', 'c3', 'c4'];

export type SeedNotesOptions = Readonly<{
  seed?: number;
  maxInitialRadius?: number;
}>;

export const seedNotes = (
  gridPoints: readonly GridPoint[],
  count: number,
  options: SeedNotesOptions = {},
): Note[] => {
  const seed = options.seed ?? 42;
  const random = mulberry32(seed);
  const maxInitialRadius2 = options.maxInitialRadius
    ? options.maxInitialRadius * options.maxInitialRadius
    : Infinity;
  const initialPoints = gridPoints.filter((p) => abs2(gridIdToDiskPoint(p.id)) <= maxInitialRadius2);
  const shuffled = [...(initialPoints.length > 0 ? initialPoints : gridPoints)];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const current = shuffled[i];
    const replacement = shuffled[j];
    if (!current || !replacement) {
      continue;
    }
    shuffled[i] = replacement;
    shuffled[j] = current;
  }

  const now = Date.now();
  const notes: Note[] = [];
  for (let i = 0; i < count; i += 1) {
    const point = shuffled[i % shuffled.length];
    if (!point) {
      break;
    }

    notes.push({
      id: `note-${i}`,
      position: point.id,
      text: WORDS[Math.floor(random() * WORDS.length)] ?? 'Note',
      color: COLORS[Math.floor(random() * COLORS.length)] ?? 'c1',
      createdAt: now,
      updatedAt: now,
    });
  }

  return notes;
};

const mulberry32 = (seed: number): (() => number) => {
  let value = seed;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
