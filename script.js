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

document.querySelector('.choices').addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;

  const choice = button.dataset.choice;

  if (choice === 'reset') {
    dogLuck = 3;
    story.textContent = 'You are Eddie. You found mysterious hotdog buns by the couch. Legend says every selfish act drains a dog\'s luck.';
    portrait.classList.remove('dimmed');
    dogLuckEl.textContent = String(dogLuck);
    return;
  }

  if (choice === 'snack') {
    story.textContent = 'You eat one bun responsibly. The universe approves. Sir Borkington remains majestic.';
    return;
  }

  if (choice === 'hoard') {
    dogLuck -= 1;
    dogLuckEl.textContent = String(Math.max(0, dogLuck));
    bounce(portrait);

    if (dogLuck <= 0) {
      portrait.classList.add('dimmed');
      story.textContent = 'Dog luck hit zero. The portrait sighs dramatically. Moral: do not hoard buns.';
    } else {
      story.textContent = `You hoard buns. Cosmic penalty! Dog luck drops to ${dogLuck}.`;
    }
    return;
  }

  if (choice === 'apology') {
    if (dogLuck < 3) {
      dogLuck += 1;
      dogLuckEl.textContent = String(dogLuck);
      portrait.classList.remove('dimmed');
      story.textContent = `You apologize sincerely. Dog luck restores to ${dogLuck}.`;
    } else {
      story.textContent = 'You apologize preemptively. The portrait nods with cautious respect.';
    }
  }
});
