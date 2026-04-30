const story = document.getElementById('story');

const scenes = {
  intro:
    'Eddie is 35 and lives with his girlfriend. In the apartment living room there is a couch, a trash can filled with hotdog buns, a dog portrait, and a microwave on a side stand.',
  act:
    'When Eddie is alone, he masturbates using hotdog buns. This has become a repeated private behavior connected to the couch and the buns in the trash can.',
  result:
    'After each episode, one dog dies. The sequence starts with his own dog and continues as a recurring consequence in the story.',
  friends:
    'Zach is his close friend with a serious and rigid demeanor; he speaks directly and stays honest. Colby is troubled but well-meaning and tries to keep Eddie grounded while the pattern continues.'
};

function showScene(key) {
  story.textContent = scenes[key];
}

document.querySelector('.choices').addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  showScene(button.dataset.choice);
});

showScene('intro');
