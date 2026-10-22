// Sample data for the demo build (VITE_DEMO=true). Nothing here is used by a real install.

// [eBird code, common name, scientific name, family (common), family (scientific), order]
const TAXA = [
  ['cangoo', 'Canada Goose', 'Branta canadensis', 'Ducks, Geese, and Waterfowl', 'Anatidae', 'Anseriformes'],
  ['truswa', 'Trumpeter Swan', 'Cygnus buccinator', 'Ducks, Geese, and Waterfowl', 'Anatidae', 'Anseriformes'],
  ['wooduc', 'Wood Duck', 'Aix sponsa', 'Ducks, Geese, and Waterfowl', 'Anatidae', 'Anseriformes'],
  ['mallar3', 'Mallard', 'Anas platyrhynchos', 'Ducks, Geese, and Waterfowl', 'Anatidae', 'Anseriformes'],
  ['comgol', 'Common Goldeneye', 'Bucephala clangula', 'Ducks, Geese, and Waterfowl', 'Anatidae', 'Anseriformes'],
  ['commer', 'Common Merganser', 'Mergus merganser', 'Ducks, Geese, and Waterfowl', 'Anatidae', 'Anseriformes'],
  ['rufgro', 'Ruffed Grouse', 'Bonasa umbellus', 'Pheasants, Grouse, and Allies', 'Phasianidae', 'Galliformes'],
  ['rocpig', 'Rock Pigeon', 'Columba livia', 'Pigeons and Doves', 'Columbidae', 'Columbiformes'],
  ['rufhum', 'Rufous Hummingbird', 'Selasphorus rufus', 'Hummingbirds', 'Trochilidae', 'Caprimulgiformes'],
  ['sancra', 'Sandhill Crane', 'Antigone canadensis', 'Cranes', 'Gruidae', 'Gruiformes'],
  ['killde', 'Killdeer', 'Charadrius vociferus', 'Plovers and Lapwings', 'Charadriidae', 'Charadriiformes'],
  ['sposan', 'Spotted Sandpiper', 'Actitis macularius', 'Sandpipers and Allies', 'Scolopacidae', 'Charadriiformes'],
  ['fragul', "Franklin's Gull", 'Leucophaeus pipixcan', 'Gulls, Terns, and Skimmers', 'Laridae', 'Charadriiformes'],
  ['comloo', 'Common Loon', 'Gavia immer', 'Loons', 'Gaviidae', 'Gaviiformes'],
  ['amwpel', 'American White Pelican', 'Pelecanus erythrorhynchos', 'Pelicans', 'Pelecanidae', 'Pelecaniformes'],
  ['grbher3', 'Great Blue Heron', 'Ardea herodias', 'Herons, Egrets, and Bitterns', 'Ardeidae', 'Pelecaniformes'],
  ['osprey', 'Osprey', 'Pandion haliaetus', 'Osprey', 'Pandionidae', 'Accipitriformes'],
  ['goleag', 'Golden Eagle', 'Aquila chrysaetos', 'Hawks, Eagles, and Kites', 'Accipitridae', 'Accipitriformes'],
  ['baleag', 'Bald Eagle', 'Haliaeetus leucocephalus', 'Hawks, Eagles, and Kites', 'Accipitridae', 'Accipitriformes'],
  ['rethaw', 'Red-tailed Hawk', 'Buteo jamaicensis', 'Hawks, Eagles, and Kites', 'Accipitridae', 'Accipitriformes'],
  ['grhowl', 'Great Horned Owl', 'Bubo virginianus', 'Owls', 'Strigidae', 'Strigiformes'],
  ['belkin1', 'Belted Kingfisher', 'Megaceryle alcyon', 'Kingfishers', 'Alcedinidae', 'Coraciiformes'],
  ['dowwoo', 'Downy Woodpecker', 'Dryobates pubescens', 'Woodpeckers', 'Picidae', 'Piciformes'],
  ['pilwoo', 'Pileated Woodpecker', 'Dryocopus pileatus', 'Woodpeckers', 'Picidae', 'Piciformes'],
  ['norfli', 'Northern Flicker', 'Colaptes auratus', 'Woodpeckers', 'Picidae', 'Piciformes'],
  ['merlin', 'Merlin', 'Falco columbarius', 'Falcons and Caracaras', 'Falconidae', 'Falconiformes'],
  ['easkin', 'Eastern Kingbird', 'Tyrannus tyrannus', 'Tyrant Flycatchers', 'Tyrannidae', 'Passeriformes'],
  ['gryjay', 'Canada Jay', 'Perisoreus canadensis', 'Crows, Jays, and Magpies', 'Corvidae', 'Passeriformes'],
  ['bkbmag1', 'Black-billed Magpie', 'Pica hudsonia', 'Crows, Jays, and Magpies', 'Corvidae', 'Passeriformes'],
  ['comrav', 'Common Raven', 'Corvus corax', 'Crows, Jays, and Magpies', 'Corvidae', 'Passeriformes'],
  ['bkcchi', 'Black-capped Chickadee', 'Poecile atricapillus', 'Tits, Chickadees, and Titmice', 'Paridae', 'Passeriformes'],
  ['mouchi', 'Mountain Chickadee', 'Poecile gambeli', 'Tits, Chickadees, and Titmice', 'Paridae', 'Passeriformes'],
  ['treswa', 'Tree Swallow', 'Tachycineta bicolor', 'Swallows', 'Hirundinidae', 'Passeriformes'],
  ['rebnut', 'Red-breasted Nuthatch', 'Sitta canadensis', 'Nuthatches', 'Sittidae', 'Passeriformes'],
  ['amedip', 'American Dipper', 'Cinclus mexicanus', 'Dippers', 'Cinclidae', 'Passeriformes'],
  ['moublu', 'Mountain Bluebird', 'Sialia currucoides', 'Thrushes and Allies', 'Turdidae', 'Passeriformes'],
  ['amerob', 'American Robin', 'Turdus migratorius', 'Thrushes and Allies', 'Turdidae', 'Passeriformes'],
  ['bohwax', 'Bohemian Waxwing', 'Bombycilla garrulus', 'Waxwings', 'Bombycillidae', 'Passeriformes'],
  ['houspa', 'House Sparrow', 'Passer domesticus', 'Old World Sparrows', 'Passeridae', 'Passeriformes'],
  ['evegro', 'Evening Grosbeak', 'Coccothraustes vespertinus', 'Finches, Euphonias, and Allies', 'Fringillidae', 'Passeriformes'],
  ['pinsis', 'Pine Siskin', 'Spinus pinus', 'Finches, Euphonias, and Allies', 'Fringillidae', 'Passeriformes'],
  ['amegfi', 'American Goldfinch', 'Spinus tristis', 'Finches, Euphonias, and Allies', 'Fringillidae', 'Passeriformes'],
  ['daejun', 'Dark-eyed Junco', 'Junco hyemalis', 'New World Sparrows', 'Passerellidae', 'Passeriformes'],
  ['whcspa', 'White-crowned Sparrow', 'Zonotrichia leucophrys', 'New World Sparrows', 'Passerellidae', 'Passeriformes'],
  ['wesmea', 'Western Meadowlark', 'Sturnella neglecta', 'Troupials and Allies', 'Icteridae', 'Passeriformes'],
  ['rewbla', 'Red-winged Blackbird', 'Agelaius phoeniceus', 'Troupials and Allies', 'Icteridae', 'Passeriformes'],
  ['yelwar', 'Yellow Warbler', 'Setophaga petechia', 'New World Warblers', 'Parulidae', 'Passeriformes'],
  ['westan', 'Western Tanager', 'Piranga ludoviciana', 'Cardinals and Allies', 'Cardinalidae', 'Passeriformes'],
];

export const SPECIES = TAXA.map(([code, common, sci, famC, famS, order], i) => ({
  id: i + 1,
  ebird_code: code,
  common_name: common,
  scientific_name: sci,
  family_common: famC,
  family_scientific: famS,
  taxon_order: order,
  taxon_sort: (i + 1) * 100,
}));

// Extra species that only appear in the eBird import preview.
export const IMPORTABLE = [
  ['buflhe', 'Bufflehead', 'Bucephala albeola', 'Ducks, Geese, and Waterfowl', 'Anatidae', 'Anseriformes', 520],
  ['amecoo', 'American Coot', 'Fulica americana', 'Rails, Gallinules, and Allies', 'Rallidae', 'Gruiformes', 950],
  ['swahaw', "Swainson's Hawk", 'Buteo swainsoni', 'Hawks, Eagles, and Kites', 'Accipitridae', 'Accipitriformes', 1990],
  ['snoowl1', 'Snowy Owl', 'Bubo scandiacus', 'Owls', 'Strigidae', 'Strigiformes', 2110],
  ['clanut', "Clark's Nutcracker", 'Nucifraga columbiana', 'Crows, Jays, and Magpies', 'Corvidae', 'Passeriformes', 2850],
  ['cedwax', 'Cedar Waxwing', 'Bombycilla cedrorum', 'Waxwings', 'Bombycillidae', 'Passeriformes', 3810],
];

export const PLACES = [
  { name: 'Glenbow Ranch Provincial Park', lat: 51.1652, lng: -114.3824 },
  { name: 'Bow River pathway, Cochrane', lat: 51.1849, lng: -114.4602 },
  { name: 'Weaselhead Flats', lat: 50.9939, lng: -114.1508 },
  { name: 'Fish Creek Provincial Park', lat: 50.9214, lng: -114.0337 },
  { name: 'Vermilion Lakes, Banff', lat: 51.1817, lng: -115.6034 },
  { name: 'Frank Lake', lat: 50.5622, lng: -113.7019 },
  { name: 'Ghost Reservoir', lat: 51.2253, lng: -114.7339 },
];

// Which species (by index in TAXA) have photos, and which were only seen.
export const PHOTOGRAPHED = [0, 1, 3, 4, 7, 9, 10, 15, 16, 18, 19, 20, 22, 24, 27, 28, 30, 33, 35, 36, 37, 41, 45, 46];
export const LOGGED_ONLY = [2, 13, 17, 23, 32, 42, 47];

/** A deterministic placeholder "photo": soft background, a perched bird silhouette. */
export function placeholderPhoto(seed, width = 1200, height = 900) {
  const palettes = [
    ['#a9bfcf', '#d9e3e8', '#5a6f5c'], // overcast sky
    ['#6f8f6a', '#a8bf98', '#3d4f36'], // spring foliage
    ['#c9b48b', '#e6d8b5', '#6e5b3b'], // dry grass
    ['#7d97a8', '#b5c7d1', '#3f4d57'], // water
    ['#8a9f7b', '#c7d1b5', '#4c5a3f'], // aspen
    ['#b8a08a', '#e0d0bf', '#5e4c3c'], // autumn
  ];
  const [a, b, branch] = palettes[seed % palettes.length];
  const flip = seed % 2 === 0 ? '' : `translate(${width} 0) scale(-1 1)`;
  const bx = 0.36 * width;
  const by = 0.42 * height;
  const s = (height / 900) * (0.9 + (seed % 5) * 0.08);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
<defs><radialGradient id="g" cx="${30 + (seed * 13) % 40}%" cy="${30 + (seed * 7) % 30}%" r="85%">
<stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></radialGradient>
<filter id="blur"><feGaussianBlur stdDeviation="30"/></filter></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<g filter="url(#blur)" opacity=".45"><circle cx="${width * 0.8}" cy="${height * 0.25}" r="${height * 0.18}" fill="${b}"/>
<circle cx="${width * 0.15}" cy="${height * 0.8}" r="${height * 0.22}" fill="${a}"/></g>
<g transform="${flip}">
<path d="M${width * 0.05} ${height * 0.72} C ${width * 0.3} ${height * 0.66}, ${width * 0.6} ${height * 0.7}, ${width * 0.98} ${height * 0.62}" stroke="${branch}" stroke-width="${height * 0.03}" fill="none" stroke-linecap="round"/>
<g transform="translate(${bx} ${by}) scale(${s})" fill="${branch}">
<ellipse cx="160" cy="150" rx="120" ry="78"/>
<circle cx="268" cy="78" r="52"/>
<path d="M312 70 L360 84 L312 92 Z"/>
<path d="M50 160 L-70 215 L-40 165 L-80 140 Z"/>
<path d="M150 220 L140 268 M190 220 L196 268" stroke="${branch}" stroke-width="10"/>
</g></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
