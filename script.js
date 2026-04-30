const couch = document.getElementById('couch');
const trash = document.getElementById('trash');
const portrait = document.getElementById('portrait');
const story = document.getElementById('story');
const dogLuckEl = document.getElementById('dogLuck');

let dogLuck = 3;

function bounce(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

[couch, trash, portrait].forEach((el) => {
  el.addEventListener('click', () => bounce(el));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      bounce(el);
    }
  });
});

const intro =
  'You are Eddie, a 35-year-old man living with your girlfriend in a weird apartment full of unresolved vibes. She has a mysterious traumatic history involving dogs and hotdog buns. Your serious best friend Zach keeps warning you to get your act together. Your troubled but well-meaning friend Colby says, “maybe don\'t do cursed stuff on the couch tonight.”';

document.querySelector('.choices').addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  const choice = button.dataset.choice;

  if (choice === 'reset') {
    dogLuck = 3;
    story.textContent = intro;
    portrait.classList.remove('dimmed');
    dogLuckEl.textContent = String(dogLuck);
    return;
  }

  if (choice === 'snack') {
    story.textContent = 'You make a normal snack. Zach nods in approval. Colby looks relieved. Your girlfriend says this is the first sane bun decision she has seen in years.';
    return;
  }

  if (choice === 'hoard') {
    dogLuck -= 1;
    dogLuckEl.textContent = String(Math.max(0, dogLuck));
    bounce(portrait);

    if (dogLuck <= 0) {
      portrait.classList.add('dimmed');
      story.textContent = 'You ignore Zach, ignore Colby, and privately relapse into your bizarre hotdog-bun masturbation ritual. Dog luck hits zero, and the portrait goes gray like a cursed warning.';
    } else {
      story.textContent = `You sneak off for another awkward hotdog-bun session. Zach calls you out. Colby tries to help. Dog luck drops to ${dogLuck}.`;
    }
    return;
  }

  if (choice === 'apology') {
    if (dogLuck < 3) {
      dogLuck += 1;
      dogLuckEl.textContent = String(dogLuck);
      portrait.classList.remove('dimmed');
      story.textContent = `You confess everything to your girlfriend, Zach, and Colby. It is painful but honest. Dog luck restores to ${dogLuck}.`;
    } else {
      story.textContent = 'You preemptively apologize to everyone, including the portrait. Zach says that is progress. Colby claps once.';
    }
  }
});

story.textContent = intro;
