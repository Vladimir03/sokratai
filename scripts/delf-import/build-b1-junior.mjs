// Сборка варианта DELF B1 Junior (Sujet_démo_B1SJ, exemple 2) для школы Эмилии.
// Источники: candidat-coll (условия), correcteur (ответы+веса), surveillant (транскрипты).
// Выход: variant.json (данные) + insert.sql (MCP-вставка) + preview.html (гейт владельца).
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const EMILIA = 'e8dede6a-727a-4254-bdb8-ce0195042a5b';
const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // RFC 4122 NS_DNS — как в ФИПИ-импорте

function uuid5(name) {
  const nsBytes = Buffer.from(NS.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([nsBytes, Buffer.from(name, 'utf8')])).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

const VARIANT_ID = uuid5('sokratai.delf-b1sj-demo2.variant');
const tid = (kim) => uuid5(`sokratai.delf-b1sj-demo2.task.${kim}`);

// ─── Блоки ───────────────────────────────────────────────────────────────────
const blocks = [
  {
    id: 'co-ex1',
    title: 'Compréhension de l’oral — Exercice 1',
    instruction: 'Vous êtes à l’école en France. Vous entendez cette conversation entre deux amies.\n\nVous aurez : 30 secondes pour lire les questions ; une première écoute, puis 30 secondes de pause ; une seconde écoute, puis 1 minute pour compléter vos réponses.\n\nПрослушайте запись и ответьте на вопросы 1–6.',
    image_url: null, audio_url: null,
    transcript: `Adolescente 1 : Salut Lucie ! Alors raconte… Comment s’est passé ton séjour ?
Adolescente 2 : C’était super ! Je suis restée quatre semaines à Boston dans une famille. Il y avait deux enfants de 14 et 11 ans. Je suis devenue très copine avec la fille de 14 ans. Elle s’appelle Joy, on parlait de tout, on s’entendait super bien !
Adolescente 1 : Vous parliez anglais ? Tu comprenais tout ?
Adolescente 2 : Oh tu sais, au début ce n’était pas facile. Les deux premiers jours je ne comprenais rien du tout ! Mais la famille était tellement sympa, on rigolait beaucoup. Et puis après quelques jours tout était plus facile.
Adolescente 1 : Et tu as bien mangé là-bas ? La cuisine est bonne ?
Adolescente 2 : Délicieuse ! En plus, comme il faisait très beau on mangeait toujours dans le jardin avec des amis ou des voisins, j’ai beaucoup parlé, tu sais !
Adolescente 1 : Tu as amélioré ton anglais alors ?
Adolescente 2 : Oui, vraiment ! Et aussi grâce à la télévision parce qu’on regardait tous les soirs deux ou trois épisodes de mes séries préférées. C’est génial, j’ai tout vu avant vous !
Adolescente 1 : Ne me dis rien, je ne veux pas connaître la fin !
Adolescente 2 : Bien sûr !
Adolescente 1 : Et tes parents, ils ne t’ont pas trop manqué ?
Adolescente 2 : Mes parents ? Non pas du tout ! C’est mon chien qui m’a manqué ! Je ne suis jamais restée aussi longtemps sans lui !`,
  },
  {
    id: 'co-ex2',
    title: 'Compréhension de l’oral — Exercice 2',
    instruction: 'Vous entendez cette émission à la radio française.\n\nПрослушайте запись и ответьте на вопросы 7–12.',
    image_url: null, audio_url: null,
    transcript: `Journaliste : « Voyager c’est bien mais voyager responsable c’est encore mieux ! Mais au fait, qu’est-ce que c’est le tourisme responsable ?
Eh bien, le tourisme responsable ou solidaire, c’est tout simplement voyager tout en cherchant à préserver l’équilibre environnemental, culturel et économique du lieu qu’on a choisi de visiter. C’est une activité en plein développement car aujourd’hui on ne veut plus seulement profiter du pays ou du village qui nous accueille, mais on souhaite de plus en plus participer réellement à la vie de celui-ci. C’est une manière de découvrir un endroit en évitant les lieux touristiques et en respectant le milieu naturel.
Alors comment ça marche ? C’est très simple ! On choisit la date, le lieu et le projet qui nous intéressent, on paye et on part ! De nombreuses agences se sont spécialisées dans ce domaine et il suffit aujourd’hui de réserver son séjour comme des vacances ordinaires. Vous pourrez, par exemple, visiter le Costa Rica en participant au projet « Sauvons les tortues », ou partir construire une école à Madagascar ou même rester près de chez vous et rénover la mairie d’un petit village. L’objectif de ce type de voyage est d’être actif et non pas un touriste passif qui visite sans vraiment découvrir la vie et les habitudes locales. Trop souvent le tourisme est une cause de dégradation de l’environnement ou de désorganisation d’une société traditionnelle alors que le voyageur doit être à l’écoute, tolérant et s’adapter à la vie locale.
Bien sûr, il ne s’agit pas de travailler mais bien de participer et les séjours sont aussi organisés de manière à se faire plaisir. Par exemple, le matin on plante des arbres pour repeupler une forêt et l’après-midi chacun reste libre de visiter ce qu’il souhaite ou de se reposer sur une plage. Ce tourisme appelé responsable, durable ou éco tourisme permet donc de valoriser et de protéger les ressources naturelles tout en contribuant à la vie économique et culturelle. »`,
  },
  {
    id: 'co-ex3',
    title: 'Compréhension de l’oral — Exercice 3',
    instruction: 'Vous avez 1 minute pour lire les questions. Puis vous entendrez une première fois un document sonore. Ensuite, vous aurez 3 minutes pour répondre aux questions. Vous écouterez une deuxième fois l’enregistrement. Après la deuxième écoute, vous aurez encore 2 minutes pour compléter vos réponses.\n\nПрослушайте запись и ответьте на вопросы 13–20.',
    image_url: null, audio_url: null,
    transcript: `Journaliste : Bonjour à tous ! Nous allons aujourd’hui parler d’école mais dans un contexte un peu particulier avec Sophie Rousseau qui est directrice de l’école de l’hôpital Ambroise Paré à Lyon, l’un des plus grands hôpitaux pour enfants et ados de France. Bonjour Sophie et merci d’être avec nous. Alors, dites-moi, on va à l’école même quand on est malade ?
Sophie Rousseau : Bonjour, oui bien sûr ! Qu’ils passent quelques jours ou plusieurs mois à l’hôpital, les enfants doivent continuer à suivre des cours. Alors s’ils ne peuvent pas se déplacer c’est l’école qui vient dans leurs chambres.
Journaliste : C’est important de garder ce lien avec les cours ?
Sophie Rousseau : Oui tout à fait, c’est extrêmement important pour les enfants ! Le lien avec l’école c’est le lien avec la société, avec le quotidien, avec la vie ordinaire en dehors de l’hôpital. Les enfants demandent souvent plus de devoirs, ça leur permet d’être occupés car, vous savez, c’est long une journée dans une chambre d’hôpital.
Journaliste : Mais qui sont les professeurs ?
Sophie Rousseau : Il y a une équipe de douze professeurs. Quatre sont employés par l’hôpital et sont là toute la semaine et les autres sont des bénévoles qui viennent environ deux jours chacun par semaine. Ce sont des professeurs de l’Éducation nationale qui ont moins d’heures de travail en échange de leur temps passé à l’hôpital.
Journaliste : Et comment vous organisez les cours avec ces enfants qui ne sont pas en pleine forme ?
Sophie Rousseau : Oh vous savez, certains ne sont jamais fatigués même avec leurs traitements médicaux ! Nous avons une classe et un emploi du temps régulier pour travailler les matières principales comme les maths ou le français. Mais l’équipe médicale peut changer ces horaires pour un traitement ou un soin important. D’ailleurs, les cours commencent à onze heures, ce qui laisse le temps aux infirmiers de faire leur travail avant. Pour les autres matières, on passe dans les chambres. On essaye de réunir deux ou trois enfants, c’est moins ennuyeux pour eux.
Journaliste : Et il y a des examens ?
Sophie Rousseau : Bien sûr ! L’année dernière trois élèves ont eu leur baccalauréat, ils étaient très fiers ! Et nous aussi ! Les trois sont sortis de l’hôpital maintenant, et ils ont pu commencer l’université sans perdre une année à cause de leurs maladies. C’est très motivant !
Journaliste : En effet ! Bravo en tout cas, merci Sophie et à bientôt !`,
  },
  {
    id: 'ce-ex1',
    title: 'Compréhension des écrits — Exercice 1',
    instruction: `Vous passez une année en France et vous souhaitez vous inscrire dans un centre de loisirs. Il doit :
– être équipé d’un café internet ;
– proposer des cours de danse et des stages photos ;
– être au centre-ville ;
– être gratuit ou offrir des réductions.

1. Centre Anatole France
Le centre Anatole France est situé dans le centre-ville, à quelques pas de la mairie. Dans cet immeuble du XVIIIᵉ siècle, vous trouverez des salles de cours, un hall d’exposition, une salle de spectacle et des activités pour tous les âges : des cours (échecs, langues étrangères), des expositions de dessins, des spectacles. Pendant les vacances, des ateliers de photographie et de théâtre sont proposés aux enfants et aux adolescents.
36, rue Martre. Tarif : 120 € par an. Bus : 2, 27 — Arrêt « Mairie ».

2. Centre Jacques Prévert
Au centre Jacques Prévert, l’équipe d’animation propose des activités culturelles et de loisirs mais aussi des activités sportives (gymnastique, danse, basket). Le centre, à 15 minutes en métro du centre, accueille souvent des expositions de photographies d’artistes locaux. Un samedi sur deux, les étudiants de l’école de journalisme organisent des discussions dans le café internet du centre.
63, rue La Fayette. Pour connaître les tarifs (réduction pour les habitants). Métro : ligne 2 — Arrêt « Centre commercial ».

3. Centre Boris Vian
Situé dans le magnifique parc des Augustes, en plein cœur de ville, vous y trouverez des salles aménagées pour les stages de photo et de cuisine (pendant les vacances scolaires), des cours de danse (moderne-jazz, classique, indienne, etc.), le café-lecture avec des journaux, un ordinateur en accès libre et du wifi, et une salle d’exposition accueillant les productions réalisées dans le centre.
6, impasse Écume. Tarifs : 55 € par an ; 50 % de réduction pour les moins de 18 ans. Bus : 2, 27 — Arrêt « Mairie ».

4. Centre Victor Hugo
Le centre Victor Hugo, situé à 20 minutes en bus de la mairie, dans le quartier des universités, est un lieu pour tous, petits et grands, jeunes et moins jeunes. Vous pourrez y pratiquer les arts plastiques, le théâtre, la danse ou le yoga. Vous êtes musicien ? Venez profiter du studio d’enregistrement et de la salle de répétitions ! (Pensez à prendre rendez-vous).
123, avenue du Juras. Tarifs : 100 € par an. Bus : A, 9, 25, 26 — Arrêt : « Universités ».`,
    image_url: null, audio_url: null, transcript: '',
  },
  {
    id: 'ce-ex2',
    title: 'Compréhension des écrits — Exercice 2',
    instruction: `Lisez cet article puis répondez aux questions.

LES CHIENS GUIDES D’AVEUGLES

Lui, brun aux yeux noirs, signe particulier : marche à quatre pattes et tire la langue. Elle, jeune, sportive, en jogging noir, profession : éducatrice de chiens guides d’aveugles. En cette fin de matinée, Djengo, jeune chien d’un an et demi, est au travail. Alexiane Da Silva l’a emmené sur une piste d’entraînement pour les chiens guides, un parcours qui reproduit les difficultés rencontrées dans la ville.

Un chien comme Djengo est éduqué (ou dressé) pour accompagner une personne aveugle ou qui voit mal et pour l’aider dans ses déplacements quotidiens.

Petit, il vivra d’abord dans une famille d’accueil qui lui donnera une première éducation. Avec elle, il apprendra qu’il ne faut pas aboyer sans raison, monter sur les canapés ou entrer dans les chambres. Pendant les promenades, le jeune chien s’habituera aux bruits de la ville, aux transports et aux magasins. Il apprendra à ne pas courir après un ballon ou à ne pas avoir peur du klaxon des voitures.

À l’âge d’un an, il entrera dans une école pour suivre une formation pendant six à huit mois. À la fin de sa formation, le chien saura parfaitement guider dans environ cinquante situations différentes et il pourra comprendre autant d’ordres. Alexiane Da Silva explique : « le chien commence par apprendre les directions, aller tout droit, à droite, à gauche, faire demi-tour. Il apprend ensuite tout ce qui concerne “la recherche”, c’est-à-dire savoir trouver et identifier les passages piétons, les pistes cyclables et les rues, s’arrêter devant les portes ou les escaliers, savoir éviter les difficultés, monter dans les transports, etc. »

Mais le chien n’est pas le seul à apprendre ! Son futur maître doit également faire un stage de formation. Le maître et le chien doivent bien se connaître mais aussi et surtout bien se comprendre. Par exemple, lorsque le chien signale quelque chose, le maître doit comprendre le sens. De plus ce dernier doit apprendre à bien tenir son chien pour permettre à l’animal de bien le conduire. C’est ce qu’a appris Hervé Brassier qui pourrait parler pendant des heures de son chien guide, Indigo : « Ce chien m’apporte beaucoup de bonheur. Je suis complètement en sécurité car j’ai une entière confiance en lui. »

Enfin, il faut savoir que l’éducation complète d’un chien guide coûte très cher et qu’en France, les dix écoles sont entièrement financées par des dons. C’est donc grâce à la générosité du grand public que, chaque année, près de 200 chiens trouvent un maître à guider.

D’après « Sensibiliser à la cause du chien guide d’aveugle », Laurence Théault — RFI et site de la Fédération française des associations chiens guides d’aveugles.`,
    image_url: null, audio_url: null, transcript: '',
  },
  {
    id: 'po',
    title: 'Production orale — ознакомление',
    instruction: `Устная часть проходит НА ЗАНЯТИИ с преподавателем — здесь ознакомьтесь с форматом и подготовьтесь.

L’épreuve se déroule en trois parties qui s’enchaînent. Elle dure entre 10 et 15 minutes.
Pour la 3e partie, vous disposez de 10 minutes de préparation. Cette préparation a lieu avant le déroulement de l’ensemble de l’épreuve.

Конкретные sujets для exercices 2 и 3 вытягиваются жребием на занятии.`,
    image_url: null, audio_url: null, transcript: '',
  },
];

// ─── Задачи ──────────────────────────────────────────────────────────────────
const FREE_NOTE = 'Corrigé допускает «toute reformulation ou réponse cohérente» — если авто-проверка дала 0 при осмысленном ответе, поставьте балл вручную.';
const VF = (statement, verdict, quote) =>
  `Vrai ou faux ? Отметьте ответ и ПРОЦИТИРУЙТЕ фразу текста, которая его подтверждает.\n(1,5 балла, только если верны И выбор, И цитата; иначе 0.)\n\n${statement}\n\nФормат ответа:\nVRAI или FAUX\nJustification : «…цитата из текста…»`;
const VF_SOL = (verdict, quote) => `${verdict}.\nJustification : « ${quote} »\n\nБалл 1,5 — только если верны И выбор VRAI/FAUX, И цитата (эквивалентный фрагмент текста засчитывается). Иначе 0 — частичного балла у этого типа нет.`;

const tasks = [
  // ── CO Exercice 1 (блок co-ex1, 6 баллов) ──
  { kim: 1, part: 1, block: 'co-ex1', max: 1, mode: 'strict', answer: 'B',
    text: 'Pendant son séjour à Boston, Lucie logeait...\nA. chez une amie.\nB. dans une famille d’accueil.\nC. dans un centre de vacances.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 2, part: 1, block: 'co-ex1', max: 1, mode: 'strict', answer: 'B',
    text: 'La copine de Lucie, Joy, a...\nA. 11 ans.\nB. 14 ans.\nC. 16 ans.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 3, part: 1, block: 'co-ex1', max: 1, mode: 'strict', answer: 'Comprendre la langue',
    text: 'Pour Lucie, qu’est-ce qui était difficile au début du séjour ?\n\nОтветьте коротко по-французски.', note: FREE_NOTE },
  { kim: 4, part: 1, block: 'co-ex1', max: 1, mode: 'strict', answer: 'La cuisine était délicieuse',
    text: 'Que pense Lucie de ce qu’elle a mangé pendant son séjour ?\n\nОтветьте коротко по-французски.', note: FREE_NOTE },
  { kim: 5, part: 1, block: 'co-ex1', max: 1, mode: 'strict', answer: 'B',
    text: 'Regarder des séries à la télévision a permis à Lucie...\nA. de ne pas s’ennuyer.\nB. d’améliorer son anglais.\nC. de raconter les épisodes à son amie.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 6, part: 1, block: 'co-ex1', max: 1, mode: 'strict', answer: 'C',
    text: 'Pendant son séjour, Lucie avait très envie de voir...\nA. ses amis.\nB. sa famille.\nC. son chien.\n\nОтвет — одна буква: A, B или C.' },

  // ── CO Exercice 2 (блок co-ex2, 8 баллов) ──
  { kim: 7, part: 1, block: 'co-ex2', max: 1, mode: 'strict', answer: 'A',
    text: 'Le journaliste parle des voyages...\nA. solidaires.\nB. professionnels.\nC. économiques.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 8, part: 1, block: 'co-ex2', max: 1, mode: 'strict', answer: 'C',
    text: 'Les voyages dont il est question dans l’émission sont...\nA. encore peu connus.\nB. difficiles à organiser.\nC. de plus en plus nombreux.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 9, part: 1, block: 'co-ex2', max: 1.5, mode: 'strict', answer: 'Construire une école',
    text: 'Quel exemple de projet à Madagascar donne le journaliste ?\n\nОтветьте коротко по-французски.', note: FREE_NOTE },
  { kim: 10, part: 1, block: 'co-ex2', max: 1.5, mode: 'strict', answer: 'Être actif',
    text: 'Quel est l’objectif des voyages dont parle le journaliste ?\n\nОтветьте коротко по-французски.',
    note: 'Corrigé: une réponse parmi « Être actif », « découvrir la vie et les habitudes locales ». ' + FREE_NOTE },
  { kim: 11, part: 1, block: 'co-ex2', max: 1, mode: 'strict', answer: 'C',
    text: 'D’après le journaliste, la personne qui choisit ce type de voyage doit aimer vivre...\nA. en ville.\nB. avec des animaux.\nC. comme les habitants du pays.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 12, part: 2, block: 'co-ex2', max: 2, mode: 'manual', answer: null,
    text: 'Quels sont, d’après le journaliste, les avantages de l’écotourisme ?\n(Plusieurs réponses possibles. DEUX réponses attendues — 1 балл за каждую.)\n\na) …\nb) …',
    solution: 'Deux réponses parmi :\n— valoriser et protéger les ressources naturelles ;\n— contribuer à la vie économique et culturelle.\n\n1 балл за каждый верный пункт (переформулировки засчитываются).' },

  // ── CO Exercice 3 (блок co-ex3, 11 баллов) ──
  { kim: 13, part: 1, block: 'co-ex3', max: 2, mode: 'strict', answer: 'C’est une école de l’hôpital',
    text: 'Quelle est la particularité de l’école de Sophie Rousseau ?\n\nОтветьте коротко по-французски.',
    note: 'Corrigé: « Il s’agit d’une école de l’hôpital (pour enfants et adolescents) ». ' + FREE_NOTE },
  { kim: 14, part: 1, block: 'co-ex3', max: 1, mode: 'strict', answer: 'B',
    text: 'L’école de Sophie Rousseau est une école pour enfants et...\nA. adultes.\nB. adolescents.\nC. personnes âgées.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 15, part: 1, block: 'co-ex3', max: 2, mode: 'strict', answer: 'Le lien avec la société',
    text: 'Avec quel autre lien Sophie Rousseau compare-t-elle le lien des enfants avec les cours ?\n(Plusieurs réponses possibles, une seule attendue.)\n\nОтветьте коротко по-французски.',
    note: 'Corrigé: « Le lien avec la société / le quotidien / la vie ordinaire ». ' + FREE_NOTE },
  { kim: 16, part: 1, block: 'co-ex3', max: 1, mode: 'strict', answer: 'A',
    text: 'Dans l’école de Sophie Rousseau, les enfants trouvent...\nA. qu’ils n’ont pas assez de devoirs.\nB. que les devoirs ne sont pas intéressants.\nC. qu’il y a beaucoup trop de devoirs.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 17, part: 1, block: 'co-ex3', max: 1, mode: 'strict', answer: 'B',
    text: 'Les professeurs bénévoles viennent à l’école de Sophie Rousseau...\nA. un jour par semaine.\nB. quelques jours par semaine.\nC. tous les jours de la semaine.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 18, part: 1, block: 'co-ex3', max: 1, mode: 'strict', answer: 'C',
    text: 'Dans l’école de Sophie Rousseau, les horaires des cours...\nA. sont très réguliers.\nB. varient selon l’équipe de professeurs.\nC. sont adaptés aux traitements médicaux.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 19, part: 1, block: 'co-ex3', max: 2, mode: 'strict', answer: 'C’est moins ennuyeux pour eux',
    text: 'Pourquoi les professeurs réunissent-ils plusieurs enfants pour les cours de certaines matières ?\n\nОтветьте коротко по-французски.',
    note: 'Corrigé: « Parce que c’est moins ennuyeux pour eux ». ' + FREE_NOTE },
  { kim: 20, part: 1, block: 'co-ex3', max: 1, mode: 'strict', answer: 'B',
    text: 'Les trois élèves de l’école de Sophie Rousseau qui ont réussi l’examen du baccalauréat...\nA. sont restés à l’hôpital.\nB. sont allés à l’université.\nC. ont arrêté leurs études.\n\nОтвет — одна буква: A, B или C.' },

  // ── CE Exercice 1 (блок ce-ex1, 10 баллов, сетка) ──
  { kim: 21, part: 2, block: 'ce-ex1', max: 10, mode: 'manual', answer: null,
    text: `Прочитайте описания четырёх центров (материал выше) и заполните таблицу: для КАЖДОГО центра укажите по каждому критерию OUI или NON (0,5 балла за каждую верную отметку; если отмечены и «oui», и «non» — 0).

Критерии: Café internet · Cours de danse · Stage photo · Lieu (centre-ville) · Tarif (gratuit ou réductions).

Формат ответа (по строке на центр):
1. Anatole France : internet …, danse …, photo …, lieu …, tarif …
2. Jacques Prévert : …
3. Boris Vian : …
4. Victor Hugo : …

В конце ответьте: Selon les critères énoncés, quel est le centre idéal ?
(Минус 1 балл, если ответ не согласуется с вашими отметками.)`,
    solution: `Эталонная сетка (0,5 балла за ячейку, 20 ячеек = 10 баллов):

1. Anatole France : internet NON, danse NON, photo OUI, lieu OUI, tarif NON
2. Jacques Prévert : internet OUI, danse OUI, photo NON, lieu NON, tarif OUI
3. Boris Vian : internet OUI, danse OUI, photo OUI, lieu OUI, tarif OUI
4. Victor Hugo : internet NON, danse OUI, photo NON, lieu NON, tarif NON

Centre idéal : 3. Centre Boris Vian (подтверждено corrigé).
Минус 1 балл, если названный центр не согласуется с проставленными отметками.` },

  // ── CE Exercice 2 (блок ce-ex2, 15 баллов) ──
  { kim: 22, part: 1, block: 'ce-ex2', max: 1, mode: 'strict', answer: 'A',
    text: 'D’après l’article, dans la vie, Alexiane...\nA. forme des chiens guides.\nB. élève des chiens guides.\nC. promène des chiens guides.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 23, part: 2, block: 'ce-ex2', max: 1.5, mode: 'manual', answer: null,
    text: VF('a) Au début du texte, le journaliste dit que Djengo se trouve dans un espace réservé aux chiens guides.'),
    solution: VF_SOL('VRAI', 'Sur une piste d’entraînement pour les chiens guides.') },
  { kim: 24, part: 2, block: 'ce-ex2', max: 1.5, mode: 'manual', answer: null,
    text: VF('b) D’après l’article, les chiens guides aident seulement les personnes complètement aveugles.'),
    solution: VF_SOL('FAUX', 'un chien comme Djengo est éduqué pour accompagner une personne aveugle ou qui voit mal.') },
  { kim: 25, part: 2, block: 'ce-ex2', max: 2, mode: 'manual', answer: null,
    text: 'Citez deux choses que le jeune chien guide apprend à ne pas faire dans sa famille d’accueil.\n(Deux réponses attendues — 1 балл за каждую.)\n\na) …\nb) …',
    solution: 'Deux réponses parmi :\n— aboyer (sans raison) ;\n— monter sur les canapés ;\n— entrer dans les chambres.\n\n1 балл за каждый верный пункт.' },
  { kim: 26, part: 2, block: 'ce-ex2', max: 1.5, mode: 'manual', answer: null,
    text: VF('Avec sa famille d’accueil, à l’extérieur de la maison, Djengo apprend à rester calme.'),
    solution: VF_SOL('VRAI', 'Pendant les promenades, […] il apprendra à ne pas courir après un ballon ou à ne pas avoir peur du klaxon des voitures.') },
  { kim: 27, part: 1, block: 'ce-ex2', max: 1, mode: 'strict', answer: 'B',
    text: 'À quel âge le chien guide entre-t-il dans une école ? À...\nA. 8 mois.\nB. 12 mois.\nC. 18 mois.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 28, part: 1, block: 'ce-ex2', max: 1, mode: 'strict', answer: 'C',
    text: 'D’après l’article, combien d’ordres un chien guide peut-il comprendre ?\nA. Entre 10 et 20.\nB. Entre 20 et 40.\nC. Entre 40 et 60.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 29, part: 1, block: 'ce-ex2', max: 1, mode: 'strict', answer: 'A',
    text: 'À l’école, on enseigne d’abord aux chiens à...\nA. se diriger.\nB. repérer les passages piétons.\nC. s’arrêter aux portes.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 30, part: 2, block: 'ce-ex2', max: 1.5, mode: 'manual', answer: null,
    text: VF('D’après l’article, le chien guide n’est pas le seul à suivre une formation.'),
    solution: VF_SOL('VRAI', 'Son futur maître doit également faire un stage de formation.') },
  { kim: 31, part: 1, block: 'ce-ex2', max: 1, mode: 'strict', answer: 'C',
    text: 'Grâce à son chien, Hervé se sent...\nA. aimé.\nB. calme.\nC. confiant.\n\nОтвет — одна буква: A, B или C.' },
  { kim: 32, part: 1, block: 'ce-ex2', max: 2, mode: 'strict', answer: 'Le grand public',
    text: 'Qui permet aux écoles de chiens guides d’exister ?\n\nОтветьте коротко по-французски.',
    note: 'Corrigé: « Le grand public ». ' + FREE_NOTE },

  // ── Production écrite (без блока, 25 баллов) ──
  { kim: 33, part: 2, block: null, max: 25, mode: 'manual', answer: null,
    text: `PRODUCTION ÉCRITE (160 mots minimum)

Vous recevez ce message d’un ami :

« Salut !
Je sais que tu as étudié en France l’année dernière. Moi aussi, je pense partir étudier dans un pays étranger mais j’hésite… Je voudrais savoir ce que tu en penses. Quelle a été ton expérience ? D’après toi, est-ce que c’est une bonne idée de faire ses études dans un autre pays ? Merci d’avance pour ta réponse !
À bientôt, Fabien »

Vous répondez à Fabien. (160 mots minimum)`,
    solution: `Оценивание по официальной grille PE DELF B1 — 5 критериев, каждый 0 / 1 / 3 / 5 (максимум 25):
1. Réalisation de la tâche — текст связный, отвечает заданию, мнение с примерами.
2. Cohérence et cohésion — логичная последовательность, связки.
3. Adéquation sociolinguistique — регистр дружеского письма.
4. Lexique — достаточный словарь уровня B1.
5. Morphosyntaxe — грамматика B1.

Правила длины (из corrigé):
— 113–143 слова → 0,5 из 1 за критерий длины;
— менее 113 слов → 0 за критерий длины;
— менее 79 слов (≈50 %) → 0 за ВСЁ задание («manque de matière évaluable»).

Аномалии (grille): hors-sujet thématique / discursif / complet, copie blanche — см. официальную grille. Итог выставляет преподаватель.` },

  // ── Production orale (блок po, 25 баллов — веса зеркалят её вариант B1 TP: 6/7/12) ──
  { kim: 34, part: 2, block: 'po', max: 6, mode: 'manual', answer: null,
    text: `EXERCICE 1 — ENTRETIEN DIRIGÉ (sans préparation, 2 à 3 minutes)

Vous parlez de vous, de vos activités, de vos centres d’intérêt. Vous parlez de votre passé, de votre présent et de vos projets.

L’épreuve se déroule sur le mode d’un entretien avec l’examinateur qui amorcera le dialogue par une question (exemples : « Bonjour... pouvez-vous vous présenter, me parler de vous, de votre famille... ? »).

⚠ Отвечать здесь ничего не нужно — эта часть сдаётся устно на занятии.`,
    solution: `Оценивается устно на занятии. Grille PO: réalisation de la tâche (entretien) 0 / 1 / 2,5 / 4 + доля лингвистических критериев (lexique, morphosyntaxe, phonologie — общие на все три части). Балл выставляет преподаватель вручную.` },
  { kim: 35, part: 2, block: 'po', max: 7, mode: 'manual', answer: null,
    text: `EXERCICE 2 — EXERCICE EN INTERACTION (sans préparation, 3 à 4 minutes)

Vous jouez le rôle qui vous est indiqué sur le document que vous avez choisi parmi les deux tirés au sort.

⚠ Sujet вытягивается на занятии; отвечать здесь ничего не нужно.`,
    solution: `Оценивается устно на занятии. Grille PO: réalisation de la tâche (interaction) 0 / 1 / 2,5 / 4 + доля лингвистических критериев. Балл выставляет преподаватель вручную.` },
  { kim: 36, part: 2, block: 'po', max: 12, mode: 'manual', answer: null,
    text: `EXERCICE 3 — EXPRESSION D’UN POINT DE VUE (préparation 10 minutes, 5 à 7 minutes)

Vous dégagez le thème soulevé par le document que vous avez choisi parmi les deux tirés au sort et vous présentez votre opinion sous la forme d’un exposé personnel de 3 minutes environ. L’examinateur pourra vous poser quelques questions.

⚠ Документ вытягивается на занятии; отвечать здесь ничего не нужно.`,
    solution: `Оценивается устно на занятии. Grille PO: réalisation de la tâche (point de vue) 0 / 1 / 2,5 / 4 + лингвистические критерии (на все три части: lexique до 4, morphosyntaxe до 5, phonologie до 4 — суммарно grille даёт /25). Балл выставляет преподаватель вручную.` },
];

// ─── Валидация сумм ──────────────────────────────────────────────────────────
const sum = (f) => tasks.filter(f).reduce((a, t) => a + t.max, 0);
const co = sum(t => t.block?.startsWith('co-'));
const ce = sum(t => t.block?.startsWith('ce-'));
const pe = sum(t => t.block === null);
const po = sum(t => t.block === 'po');
const p1 = sum(t => t.part === 1);
const p2 = sum(t => t.part === 2);
console.log(`CO=${co} (жду 25) · CE=${ce} (жду 25) · PE=${pe} (жду 25) · PO=${po} (жду 25) · P1=${p1} · P2=${p2} · total=${p1 + p2} · tasks=${tasks.length}`);
if (co !== 25 || ce !== 25 || pe !== 25) throw new Error('СУММЫ НЕ СХОДЯТСЯ');
const kims = new Set(tasks.map(t => t.kim));
if (kims.size !== tasks.length) throw new Error('ДУБЛЬ КИМ');

// ─── SQL ─────────────────────────────────────────────────────────────────────
const q = (s) => s === null || s === undefined ? 'NULL' : `$tx$${s}$tx$`;
const blocksJson = JSON.stringify(blocks.map(b => ({ id: b.id, title: b.title, instruction: b.instruction, image_url: b.image_url, audio_url: b.audio_url })));
const transcriptsJson = JSON.stringify(Object.fromEntries(blocks.filter(b => b.transcript).map(b => [b.id, b.transcript])));

let sql = `-- DELF B1 Junior (Sujet_démo_B1SJ exemple 2) — вариант для школы Эмилии.
-- Источник: официальные демо-документы France Éducation international (CIEP).
-- Вставка insert-only (детерминированные uuid5 + ON CONFLICT DO NOTHING);
-- аудио блоков прикрепляют кураторы в редакторе (own-namespace storage).
BEGIN;

INSERT INTO public.mock_exam_variants (
  id, title, exam_type, source, source_attribution, duration_minutes,
  total_max_score, part1_max, part2_max, task_count,
  created_by, owner_id, subject, variant_pdf_url,
  listening_audio_url, listening_transcript,
  task_blocks_json, block_transcripts_json, content_revision
) VALUES (
  '${VARIANT_ID}',
  ${q('DELF B1 Junior — Sujet démo (exemple 2)')},
  'ege', 'tutor',
  ${q('DELF B1 SJ — sujet démo officiel (France Éducation international)')},
  105,
  ${p1 + p2}, ${p1}, ${p2}, ${tasks.length},
  '${EMILIA}', '${EMILIA}', 'french', NULL,
  NULL, NULL,
  ${q(blocksJson)}::jsonb,
  ${q(transcriptsJson)}::jsonb,
  1
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num, task_text, task_image_url,
  correct_answer, check_mode, max_score, solution_text, solution_image_urls, topic, block_id
) VALUES
`;
sql += tasks.map((t, i) => {
  const solution = t.solution ?? t.note ?? null;
  return `('${tid(t.kim)}', '${VARIANT_ID}', ${t.kim}, ${t.part}, ${i + 1}, ${q(t.text)}, NULL, ${q(t.answer)}, '${t.mode}', ${t.max}, ${q(solution)}, NULL, NULL, ${t.block ? `'${t.block}'` : 'NULL'})`;
}).join(',\n');
sql += `
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Validation:
-- SELECT part, count(*), sum(max_score) FROM mock_exam_variant_tasks WHERE variant_id='${VARIANT_ID}' GROUP BY part;
-- Жду: part1 -> ${tasks.filter(t=>t.part===1).length} задач / ${p1} б.; part2 -> ${tasks.filter(t=>t.part===2).length} задач / ${p2} б.
-- Откат: DELETE FROM mock_exam_variant_tasks WHERE variant_id='${VARIANT_ID}'; DELETE FROM mock_exam_variants WHERE id='${VARIANT_ID}';
`;

const OUT = 'C:/Users/kamch/AppData/Local/Temp/claude/C--Users-kamch-sokratai/719d7279-de5e-4812-9f7d-79aa00742fa4/scratchpad/b1junior/';
writeFileSync(OUT + 'variant.json', JSON.stringify({ variantId: VARIANT_ID, blocks, tasks }, null, 2), 'utf8');
writeFileSync(OUT + 'insert.sql', sql, 'utf8');
console.log('variant id:', VARIANT_ID);
console.log('files written: variant.json, insert.sql (' + sql.length + ' chars)');
