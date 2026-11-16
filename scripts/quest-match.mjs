// Сопоставление квеста с вики и квеста из кода игры (по тому, кто даёт, и названию).
export const questNameKey = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
// на вики «Bamboo Boogie 2: Bamboo Boogaloo» хранится как «Bamboo Boogaloo» — сравниваем и хвост после двоеточия
export const sameQuest = (wikiQuest, gameQuest) => wikiQuest.giver === gameQuest.giver
  && [gameQuest.name, gameQuest.name.replace(/^.*?:\s*/, '')].some((n) => questNameKey(n) === questNameKey(wikiQuest.name));
