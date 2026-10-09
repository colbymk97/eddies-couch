import { LineDeck } from '../core/util';

export const EDDIE = {
  snore: new LineDeck(['Zzz... buns... zzz', 'mmm... sectional...', 'zzz... no, Theo... zzz', 'zzz... Scotchgard... zzz', '*snort* ...cupholders...']),
  wake: new LineDeck(['¿¡QUÉ FUE ESO!?', 'Who is in my living room?!', '*snort* ...was that a SPLAT?']),
  alarm: new LineDeck(['Nap over. Couch patrol.', 'Okay. Time to check on my babies.']),
  spot: new LineDeck([
    '¡THEO!',
    '¡OYE! Away from the cushions!',
    '¡Ven acá, mijo!',
    'You! Small man! FREEZE!',
    'Not on my watch, diaper boy!',
    'I SEE YOU, little geyser!',
  ]),
  chase: new LineDeck([
    '¡No en el sofá!',
    "That's Italian leather! ...It's from Costco but STILL!",
    'I just Scotchgarded that!',
    '¡Ay, Dios mío, the throw pillows!',
    'Who raised you?!',
    'This is a NO-PUKE household!',
    'Come back here, you little sprinkler!',
    'I have an upholstery GUY, Theo! He is EXPENSIVE!',
    '¡Mis cojines!',
    'TIMEOUT! You are getting a TIMEOUT!',
    'Do you know what these couches MEAN to me?!',
    'Stop hurling and start crawling... AWAY!',
  ]),
  lost: new LineDeck(['¿Dónde estás, mijo...?', 'I can smell you. You smell like buns.', 'Okay. Deep breaths, Eddie.', 'He went... somewhere. Ugh.']),
  investigate: new LineDeck(['¿Hola...?', 'That better not be what I think it is...', 'Was that... a splort?', 'I heard a gurgle.', 'Something smells... chunky.']),
  clean: new LineDeck([
    "Shhh, it's okay baby, daddy's here.",
    "Bit of club soda... you'll be fine, gorgeous.",
    'Nobody will ever know.',
    'Scrub scrub scrub scrub...',
    'Good as new. Mostly.',
  ]),
  cleaned: new LineDeck(['There. Pristine.', '*sniff* ...still smells like carrots.', 'Back to normal, baby.']),
  dirty: new LineDeck(['¿¡QUÉ ES ESTO!?', 'A STAIN?! On MY cushion?!', 'Oh no. Oh no no no.']),
  slip: new LineDeck(['WHOA-WHOA-WHOA—', '¡AY, MI ESPALDA!', 'Not again...', 'Who put that THERE?!']),
  catch: new LineDeck(['¡TE TENGO!', 'GOTCHA, you little sprinkler!', 'Timeout. NOW.', 'Caught you, chunky!']),
  pukedOn: new LineDeck(['...', '...he got me in the mouth.', '¡ASQUEROSO!', 'I need a minute. And a shower. And therapy.']),
  squeak: new LineDeck(['¿Biscuit? Is that you, buddy?', 'Who is squeaking?!', '...Biscuit?']),
  beast: 'THAT IS IT. NO MORE MR. NICE EDDIE.',
  rage: new LineDeck(['I am getting VERY upset!', 'My blood pressure!!', 'I need a bigger spray bottle.']),
};

export const THEO = {
  bun: new LineDeck(['Mmm, trash bun.', 'nom nom', 'bun!', 'yummy garbage']),
  heave: new LineDeck(['*hurrk*... nothing left.', 'tummy empty...', 'need bun.']),
  hide: new LineDeck(['shhh...', 'hehe', '*giggle*']),
  zoomies: 'ZOOMIES!',
};

export const POP = {
  seat: ['SPLORT!', 'BLEGH!', 'HURK!', 'SPLAT!', 'BLARF!', 'SPLOOSH!', 'GLORP!'],
  floor: ['splat.', 'blorp.', 'plop.'],
  plastic: ['SLIDES OFF THE PLASTIC!', 'BOING! Plastic popped!'],
};

export const TIPS = [
  'Eddie owns 400 hotdog buns. He has never owned a hotdog.',
  'Missed shots leave puddles. Eddie slips on puddles.',
  'Hold to charge a MEGA HURL. It can soak several seats at once.',
  'Eddie scrubs half-puked couches clean. Finish what you start.',
  'Ruin a whole couch and Eddie needs a moment to grieve.',
  'Crawl under the dining table or the bed. Eddie is too big to follow.',
  'Throw a squeaky toy to lure Eddie away. He misses his dog.',
  "The microwave makes a Mystery Burrito every so often. Nobody knows what's in it.",
  'Juice boxes give you the zoomies.',
  'Nobody sits on the white couch.',
];

export interface Rank {
  min: number;
  grade: string;
  title: string;
  blurb: string;
}

export const RANKS: Rank[] = [
  { min: 16000, grade: 'S', title: 'SOFA KING', blurb: 'Eddie has moved into a hammock. Permanently.' },
  { min: 12000, grade: 'A', title: 'COUCH POTENTATE', blurb: "Eddie's upholstery guy just bought a boat." },
  { min: 8500, grade: 'B', title: 'UPHOLSTERY TERRORIST', blurb: 'The dogs in the portraits are proud of you.' },
  { min: 5000, grade: 'C', title: 'CUSHION CRUSHER', blurb: 'Respectable carnage. Eddie will need a minute.' },
  { min: 0, grade: 'D', title: 'MILD SPIT-UP', blurb: 'That was barely a burp, Theo.' },
];

export function rankFor(score: number) {
  return RANKS.find((r) => score >= r.min) ?? RANKS[RANKS.length - 1];
}
