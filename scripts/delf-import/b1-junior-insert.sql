-- DELF B1 Junior (Sujet_démo_B1SJ exemple 2) — вариант для школы Эмилии.
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
  '3934598e-10f7-5110-81c5-c7dddaa97df2',
  $tx$DELF B1 Junior — Sujet démo (exemple 2)$tx$,
  'ege', 'tutor',
  $tx$DELF B1 SJ — sujet démo officiel (France Éducation international)$tx$,
  105,
  100, 30, 70, 36,
  'e8dede6a-727a-4254-bdb8-ce0195042a5b', 'e8dede6a-727a-4254-bdb8-ce0195042a5b', 'french', NULL,
  NULL, NULL,
  $tx$[{"id":"co-ex1","title":"Compréhension de l’oral — Exercice 1","instruction":"Vous êtes à l’école en France. Vous entendez cette conversation entre deux amies.\n\nVous aurez : 30 secondes pour lire les questions ; une première écoute, puis 30 secondes de pause ; une seconde écoute, puis 1 minute pour compléter vos réponses.\n\nПрослушайте запись и ответьте на вопросы 1–6.","image_url":null,"audio_url":null},{"id":"co-ex2","title":"Compréhension de l’oral — Exercice 2","instruction":"Vous entendez cette émission à la radio française.\n\nПрослушайте запись и ответьте на вопросы 7–12.","image_url":null,"audio_url":null},{"id":"co-ex3","title":"Compréhension de l’oral — Exercice 3","instruction":"Vous avez 1 minute pour lire les questions. Puis vous entendrez une première fois un document sonore. Ensuite, vous aurez 3 minutes pour répondre aux questions. Vous écouterez une deuxième fois l’enregistrement. Après la deuxième écoute, vous aurez encore 2 minutes pour compléter vos réponses.\n\nПрослушайте запись и ответьте на вопросы 13–20.","image_url":null,"audio_url":null},{"id":"ce-ex1","title":"Compréhension des écrits — Exercice 1","instruction":"Vous passez une année en France et vous souhaitez vous inscrire dans un centre de loisirs. Il doit :\n– être équipé d’un café internet ;\n– proposer des cours de danse et des stages photos ;\n– être au centre-ville ;\n– être gratuit ou offrir des réductions.\n\n1. Centre Anatole France\nLe centre Anatole France est situé dans le centre-ville, à quelques pas de la mairie. Dans cet immeuble du XVIIIᵉ siècle, vous trouverez des salles de cours, un hall d’exposition, une salle de spectacle et des activités pour tous les âges : des cours (échecs, langues étrangères), des expositions de dessins, des spectacles. Pendant les vacances, des ateliers de photographie et de théâtre sont proposés aux enfants et aux adolescents.\n36, rue Martre. Tarif : 120 € par an. Bus : 2, 27 — Arrêt « Mairie ».\n\n2. Centre Jacques Prévert\nAu centre Jacques Prévert, l’équipe d’animation propose des activités culturelles et de loisirs mais aussi des activités sportives (gymnastique, danse, basket). Le centre, à 15 minutes en métro du centre, accueille souvent des expositions de photographies d’artistes locaux. Un samedi sur deux, les étudiants de l’école de journalisme organisent des discussions dans le café internet du centre.\n63, rue La Fayette. Pour connaître les tarifs (réduction pour les habitants). Métro : ligne 2 — Arrêt « Centre commercial ».\n\n3. Centre Boris Vian\nSitué dans le magnifique parc des Augustes, en plein cœur de ville, vous y trouverez des salles aménagées pour les stages de photo et de cuisine (pendant les vacances scolaires), des cours de danse (moderne-jazz, classique, indienne, etc.), le café-lecture avec des journaux, un ordinateur en accès libre et du wifi, et une salle d’exposition accueillant les productions réalisées dans le centre.\n6, impasse Écume. Tarifs : 55 € par an ; 50 % de réduction pour les moins de 18 ans. Bus : 2, 27 — Arrêt « Mairie ».\n\n4. Centre Victor Hugo\nLe centre Victor Hugo, situé à 20 minutes en bus de la mairie, dans le quartier des universités, est un lieu pour tous, petits et grands, jeunes et moins jeunes. Vous pourrez y pratiquer les arts plastiques, le théâtre, la danse ou le yoga. Vous êtes musicien ? Venez profiter du studio d’enregistrement et de la salle de répétitions ! (Pensez à prendre rendez-vous).\n123, avenue du Juras. Tarifs : 100 € par an. Bus : A, 9, 25, 26 — Arrêt : « Universités ».","image_url":null,"audio_url":null},{"id":"ce-ex2","title":"Compréhension des écrits — Exercice 2","instruction":"Lisez cet article puis répondez aux questions.\n\nLES CHIENS GUIDES D’AVEUGLES\n\nLui, brun aux yeux noirs, signe particulier : marche à quatre pattes et tire la langue. Elle, jeune, sportive, en jogging noir, profession : éducatrice de chiens guides d’aveugles. En cette fin de matinée, Djengo, jeune chien d’un an et demi, est au travail. Alexiane Da Silva l’a emmené sur une piste d’entraînement pour les chiens guides, un parcours qui reproduit les difficultés rencontrées dans la ville.\n\nUn chien comme Djengo est éduqué (ou dressé) pour accompagner une personne aveugle ou qui voit mal et pour l’aider dans ses déplacements quotidiens.\n\nPetit, il vivra d’abord dans une famille d’accueil qui lui donnera une première éducation. Avec elle, il apprendra qu’il ne faut pas aboyer sans raison, monter sur les canapés ou entrer dans les chambres. Pendant les promenades, le jeune chien s’habituera aux bruits de la ville, aux transports et aux magasins. Il apprendra à ne pas courir après un ballon ou à ne pas avoir peur du klaxon des voitures.\n\nÀ l’âge d’un an, il entrera dans une école pour suivre une formation pendant six à huit mois. À la fin de sa formation, le chien saura parfaitement guider dans environ cinquante situations différentes et il pourra comprendre autant d’ordres. Alexiane Da Silva explique : « le chien commence par apprendre les directions, aller tout droit, à droite, à gauche, faire demi-tour. Il apprend ensuite tout ce qui concerne “la recherche”, c’est-à-dire savoir trouver et identifier les passages piétons, les pistes cyclables et les rues, s’arrêter devant les portes ou les escaliers, savoir éviter les difficultés, monter dans les transports, etc. »\n\nMais le chien n’est pas le seul à apprendre ! Son futur maître doit également faire un stage de formation. Le maître et le chien doivent bien se connaître mais aussi et surtout bien se comprendre. Par exemple, lorsque le chien signale quelque chose, le maître doit comprendre le sens. De plus ce dernier doit apprendre à bien tenir son chien pour permettre à l’animal de bien le conduire. C’est ce qu’a appris Hervé Brassier qui pourrait parler pendant des heures de son chien guide, Indigo : « Ce chien m’apporte beaucoup de bonheur. Je suis complètement en sécurité car j’ai une entière confiance en lui. »\n\nEnfin, il faut savoir que l’éducation complète d’un chien guide coûte très cher et qu’en France, les dix écoles sont entièrement financées par des dons. C’est donc grâce à la générosité du grand public que, chaque année, près de 200 chiens trouvent un maître à guider.\n\nD’après « Sensibiliser à la cause du chien guide d’aveugle », Laurence Théault — RFI et site de la Fédération française des associations chiens guides d’aveugles.","image_url":null,"audio_url":null},{"id":"po","title":"Production orale — ознакомление","instruction":"Устная часть проходит НА ЗАНЯТИИ с преподавателем — здесь ознакомьтесь с форматом и подготовьтесь.\n\nL’épreuve se déroule en trois parties qui s’enchaînent. Elle dure entre 10 et 15 minutes.\nPour la 3e partie, vous disposez de 10 minutes de préparation. Cette préparation a lieu avant le déroulement de l’ensemble de l’épreuve.\n\nКонкретные sujets для exercices 2 и 3 вытягиваются жребием на занятии.","image_url":null,"audio_url":null}]$tx$::jsonb,
  $tx${"co-ex1":"Adolescente 1 : Salut Lucie ! Alors raconte… Comment s’est passé ton séjour ?\nAdolescente 2 : C’était super ! Je suis restée quatre semaines à Boston dans une famille. Il y avait deux enfants de 14 et 11 ans. Je suis devenue très copine avec la fille de 14 ans. Elle s’appelle Joy, on parlait de tout, on s’entendait super bien !\nAdolescente 1 : Vous parliez anglais ? Tu comprenais tout ?\nAdolescente 2 : Oh tu sais, au début ce n’était pas facile. Les deux premiers jours je ne comprenais rien du tout ! Mais la famille était tellement sympa, on rigolait beaucoup. Et puis après quelques jours tout était plus facile.\nAdolescente 1 : Et tu as bien mangé là-bas ? La cuisine est bonne ?\nAdolescente 2 : Délicieuse ! En plus, comme il faisait très beau on mangeait toujours dans le jardin avec des amis ou des voisins, j’ai beaucoup parlé, tu sais !\nAdolescente 1 : Tu as amélioré ton anglais alors ?\nAdolescente 2 : Oui, vraiment ! Et aussi grâce à la télévision parce qu’on regardait tous les soirs deux ou trois épisodes de mes séries préférées. C’est génial, j’ai tout vu avant vous !\nAdolescente 1 : Ne me dis rien, je ne veux pas connaître la fin !\nAdolescente 2 : Bien sûr !\nAdolescente 1 : Et tes parents, ils ne t’ont pas trop manqué ?\nAdolescente 2 : Mes parents ? Non pas du tout ! C’est mon chien qui m’a manqué ! Je ne suis jamais restée aussi longtemps sans lui !","co-ex2":"Journaliste : « Voyager c’est bien mais voyager responsable c’est encore mieux ! Mais au fait, qu’est-ce que c’est le tourisme responsable ?\nEh bien, le tourisme responsable ou solidaire, c’est tout simplement voyager tout en cherchant à préserver l’équilibre environnemental, culturel et économique du lieu qu’on a choisi de visiter. C’est une activité en plein développement car aujourd’hui on ne veut plus seulement profiter du pays ou du village qui nous accueille, mais on souhaite de plus en plus participer réellement à la vie de celui-ci. C’est une manière de découvrir un endroit en évitant les lieux touristiques et en respectant le milieu naturel.\nAlors comment ça marche ? C’est très simple ! On choisit la date, le lieu et le projet qui nous intéressent, on paye et on part ! De nombreuses agences se sont spécialisées dans ce domaine et il suffit aujourd’hui de réserver son séjour comme des vacances ordinaires. Vous pourrez, par exemple, visiter le Costa Rica en participant au projet « Sauvons les tortues », ou partir construire une école à Madagascar ou même rester près de chez vous et rénover la mairie d’un petit village. L’objectif de ce type de voyage est d’être actif et non pas un touriste passif qui visite sans vraiment découvrir la vie et les habitudes locales. Trop souvent le tourisme est une cause de dégradation de l’environnement ou de désorganisation d’une société traditionnelle alors que le voyageur doit être à l’écoute, tolérant et s’adapter à la vie locale.\nBien sûr, il ne s’agit pas de travailler mais bien de participer et les séjours sont aussi organisés de manière à se faire plaisir. Par exemple, le matin on plante des arbres pour repeupler une forêt et l’après-midi chacun reste libre de visiter ce qu’il souhaite ou de se reposer sur une plage. Ce tourisme appelé responsable, durable ou éco tourisme permet donc de valoriser et de protéger les ressources naturelles tout en contribuant à la vie économique et culturelle. »","co-ex3":"Journaliste : Bonjour à tous ! Nous allons aujourd’hui parler d’école mais dans un contexte un peu particulier avec Sophie Rousseau qui est directrice de l’école de l’hôpital Ambroise Paré à Lyon, l’un des plus grands hôpitaux pour enfants et ados de France. Bonjour Sophie et merci d’être avec nous. Alors, dites-moi, on va à l’école même quand on est malade ?\nSophie Rousseau : Bonjour, oui bien sûr ! Qu’ils passent quelques jours ou plusieurs mois à l’hôpital, les enfants doivent continuer à suivre des cours. Alors s’ils ne peuvent pas se déplacer c’est l’école qui vient dans leurs chambres.\nJournaliste : C’est important de garder ce lien avec les cours ?\nSophie Rousseau : Oui tout à fait, c’est extrêmement important pour les enfants ! Le lien avec l’école c’est le lien avec la société, avec le quotidien, avec la vie ordinaire en dehors de l’hôpital. Les enfants demandent souvent plus de devoirs, ça leur permet d’être occupés car, vous savez, c’est long une journée dans une chambre d’hôpital.\nJournaliste : Mais qui sont les professeurs ?\nSophie Rousseau : Il y a une équipe de douze professeurs. Quatre sont employés par l’hôpital et sont là toute la semaine et les autres sont des bénévoles qui viennent environ deux jours chacun par semaine. Ce sont des professeurs de l’Éducation nationale qui ont moins d’heures de travail en échange de leur temps passé à l’hôpital.\nJournaliste : Et comment vous organisez les cours avec ces enfants qui ne sont pas en pleine forme ?\nSophie Rousseau : Oh vous savez, certains ne sont jamais fatigués même avec leurs traitements médicaux ! Nous avons une classe et un emploi du temps régulier pour travailler les matières principales comme les maths ou le français. Mais l’équipe médicale peut changer ces horaires pour un traitement ou un soin important. D’ailleurs, les cours commencent à onze heures, ce qui laisse le temps aux infirmiers de faire leur travail avant. Pour les autres matières, on passe dans les chambres. On essaye de réunir deux ou trois enfants, c’est moins ennuyeux pour eux.\nJournaliste : Et il y a des examens ?\nSophie Rousseau : Bien sûr ! L’année dernière trois élèves ont eu leur baccalauréat, ils étaient très fiers ! Et nous aussi ! Les trois sont sortis de l’hôpital maintenant, et ils ont pu commencer l’université sans perdre une année à cause de leurs maladies. C’est très motivant !\nJournaliste : En effet ! Bravo en tout cas, merci Sophie et à bientôt !"}$tx$::jsonb,
  1
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.mock_exam_variant_tasks (
  id, variant_id, kim_number, part, order_num, task_text, task_image_url,
  correct_answer, check_mode, max_score, solution_text, solution_image_urls, topic, block_id
) VALUES
('af64cded-557c-5cf3-b83a-f8609fb2cf72', '3934598e-10f7-5110-81c5-c7dddaa97df2', 1, 1, 1, $tx$Pendant son séjour à Boston, Lucie logeait...
A. chez une amie.
B. dans une famille d’accueil.
C. dans un centre de vacances.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$B$tx$, 'strict', 1, NULL, NULL, NULL, 'co-ex1'),
('1d2b2d39-10fe-52a0-b4e4-ac01870cffeb', '3934598e-10f7-5110-81c5-c7dddaa97df2', 2, 1, 2, $tx$La copine de Lucie, Joy, a...
A. 11 ans.
B. 14 ans.
C. 16 ans.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$B$tx$, 'strict', 1, NULL, NULL, NULL, 'co-ex1'),
('537f0003-c6c8-5acd-b37c-82f29bb6caea', '3934598e-10f7-5110-81c5-c7dddaa97df2', 3, 1, 3, $tx$Pour Lucie, qu’est-ce qui était difficile au début du séjour ?

Ответьте коротко по-французски.$tx$, NULL, $tx$Comprendre la langue$tx$, 'strict', 1, $tx$Corrigé допускает «toute reformulation ou réponse cohérente» — если авто-проверка дала 0 при осмысленном ответе, поставьте балл вручную.$tx$, NULL, NULL, 'co-ex1'),
('457c3575-d821-5592-98d9-84e4d5b1bc02', '3934598e-10f7-5110-81c5-c7dddaa97df2', 4, 1, 4, $tx$Que pense Lucie de ce qu’elle a mangé pendant son séjour ?

Ответьте коротко по-французски.$tx$, NULL, $tx$La cuisine était délicieuse$tx$, 'strict', 1, $tx$Corrigé допускает «toute reformulation ou réponse cohérente» — если авто-проверка дала 0 при осмысленном ответе, поставьте балл вручную.$tx$, NULL, NULL, 'co-ex1'),
('d407a0db-085a-51c3-9486-f9ebf3a699d0', '3934598e-10f7-5110-81c5-c7dddaa97df2', 5, 1, 5, $tx$Regarder des séries à la télévision a permis à Lucie...
A. de ne pas s’ennuyer.
B. d’améliorer son anglais.
C. de raconter les épisodes à son amie.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$B$tx$, 'strict', 1, NULL, NULL, NULL, 'co-ex1'),
('6536a012-b316-5007-b244-fa330457f7b9', '3934598e-10f7-5110-81c5-c7dddaa97df2', 6, 1, 6, $tx$Pendant son séjour, Lucie avait très envie de voir...
A. ses amis.
B. sa famille.
C. son chien.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$C$tx$, 'strict', 1, NULL, NULL, NULL, 'co-ex1'),
('60a984ac-7117-560d-9847-ed1a01608dd8', '3934598e-10f7-5110-81c5-c7dddaa97df2', 7, 1, 7, $tx$Le journaliste parle des voyages...
A. solidaires.
B. professionnels.
C. économiques.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$A$tx$, 'strict', 1, NULL, NULL, NULL, 'co-ex2'),
('2c713622-4505-5c70-9eaf-afac70c88190', '3934598e-10f7-5110-81c5-c7dddaa97df2', 8, 1, 8, $tx$Les voyages dont il est question dans l’émission sont...
A. encore peu connus.
B. difficiles à organiser.
C. de plus en plus nombreux.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$C$tx$, 'strict', 1, NULL, NULL, NULL, 'co-ex2'),
('ec84520c-db88-5ead-8b65-036a8acb3a2a', '3934598e-10f7-5110-81c5-c7dddaa97df2', 9, 1, 9, $tx$Quel exemple de projet à Madagascar donne le journaliste ?

Ответьте коротко по-французски.$tx$, NULL, $tx$Construire une école$tx$, 'strict', 1.5, $tx$Corrigé допускает «toute reformulation ou réponse cohérente» — если авто-проверка дала 0 при осмысленном ответе, поставьте балл вручную.$tx$, NULL, NULL, 'co-ex2'),
('e73a86fa-0789-594b-89a1-d3317d271732', '3934598e-10f7-5110-81c5-c7dddaa97df2', 10, 1, 10, $tx$Quel est l’objectif des voyages dont parle le journaliste ?

Ответьте коротко по-французски.$tx$, NULL, $tx$Être actif$tx$, 'strict', 1.5, $tx$Corrigé: une réponse parmi « Être actif », « découvrir la vie et les habitudes locales ». Corrigé допускает «toute reformulation ou réponse cohérente» — если авто-проверка дала 0 при осмысленном ответе, поставьте балл вручную.$tx$, NULL, NULL, 'co-ex2'),
('13d800ed-25b9-5a0f-b77b-464120d03996', '3934598e-10f7-5110-81c5-c7dddaa97df2', 11, 1, 11, $tx$D’après le journaliste, la personne qui choisit ce type de voyage doit aimer vivre...
A. en ville.
B. avec des animaux.
C. comme les habitants du pays.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$C$tx$, 'strict', 1, NULL, NULL, NULL, 'co-ex2'),
('87300220-fdd6-5221-ab13-5086ea738fbd', '3934598e-10f7-5110-81c5-c7dddaa97df2', 12, 2, 12, $tx$Quels sont, d’après le journaliste, les avantages de l’écotourisme ?
(Plusieurs réponses possibles. DEUX réponses attendues — 1 балл за каждую.)

a) …
b) …$tx$, NULL, NULL, 'manual', 2, $tx$Deux réponses parmi :
— valoriser et protéger les ressources naturelles ;
— contribuer à la vie économique et culturelle.

1 балл за каждый верный пункт (переформулировки засчитываются).$tx$, NULL, NULL, 'co-ex2'),
('d41c2b22-0313-5ee9-8879-80d074ac6ca9', '3934598e-10f7-5110-81c5-c7dddaa97df2', 13, 1, 13, $tx$Quelle est la particularité de l’école de Sophie Rousseau ?

Ответьте коротко по-французски.$tx$, NULL, $tx$C’est une école de l’hôpital$tx$, 'strict', 2, $tx$Corrigé: « Il s’agit d’une école de l’hôpital (pour enfants et adolescents) ». Corrigé допускает «toute reformulation ou réponse cohérente» — если авто-проверка дала 0 при осмысленном ответе, поставьте балл вручную.$tx$, NULL, NULL, 'co-ex3'),
('10c86359-4888-51bc-aaa0-5f1bd35a6dcb', '3934598e-10f7-5110-81c5-c7dddaa97df2', 14, 1, 14, $tx$L’école de Sophie Rousseau est une école pour enfants et...
A. adultes.
B. adolescents.
C. personnes âgées.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$B$tx$, 'strict', 1, NULL, NULL, NULL, 'co-ex3'),
('d772d2a6-59f3-5e04-abca-ad19d1b57f15', '3934598e-10f7-5110-81c5-c7dddaa97df2', 15, 1, 15, $tx$Avec quel autre lien Sophie Rousseau compare-t-elle le lien des enfants avec les cours ?
(Plusieurs réponses possibles, une seule attendue.)

Ответьте коротко по-французски.$tx$, NULL, $tx$Le lien avec la société$tx$, 'strict', 2, $tx$Corrigé: « Le lien avec la société / le quotidien / la vie ordinaire ». Corrigé допускает «toute reformulation ou réponse cohérente» — если авто-проверка дала 0 при осмысленном ответе, поставьте балл вручную.$tx$, NULL, NULL, 'co-ex3'),
('95d73c9e-4d8b-5a56-8263-e4c59ceea603', '3934598e-10f7-5110-81c5-c7dddaa97df2', 16, 1, 16, $tx$Dans l’école de Sophie Rousseau, les enfants trouvent...
A. qu’ils n’ont pas assez de devoirs.
B. que les devoirs ne sont pas intéressants.
C. qu’il y a beaucoup trop de devoirs.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$A$tx$, 'strict', 1, NULL, NULL, NULL, 'co-ex3'),
('2e48dea1-5703-5b91-96c2-fffc48b2df7c', '3934598e-10f7-5110-81c5-c7dddaa97df2', 17, 1, 17, $tx$Les professeurs bénévoles viennent à l’école de Sophie Rousseau...
A. un jour par semaine.
B. quelques jours par semaine.
C. tous les jours de la semaine.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$B$tx$, 'strict', 1, NULL, NULL, NULL, 'co-ex3'),
('07068b8f-e18c-511f-8143-6bcfe7f4e844', '3934598e-10f7-5110-81c5-c7dddaa97df2', 18, 1, 18, $tx$Dans l’école de Sophie Rousseau, les horaires des cours...
A. sont très réguliers.
B. varient selon l’équipe de professeurs.
C. sont adaptés aux traitements médicaux.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$C$tx$, 'strict', 1, NULL, NULL, NULL, 'co-ex3'),
('f242c848-3824-50a9-864b-13405a4e2ecd', '3934598e-10f7-5110-81c5-c7dddaa97df2', 19, 1, 19, $tx$Pourquoi les professeurs réunissent-ils plusieurs enfants pour les cours de certaines matières ?

Ответьте коротко по-французски.$tx$, NULL, $tx$C’est moins ennuyeux pour eux$tx$, 'strict', 2, $tx$Corrigé: « Parce que c’est moins ennuyeux pour eux ». Corrigé допускает «toute reformulation ou réponse cohérente» — если авто-проверка дала 0 при осмысленном ответе, поставьте балл вручную.$tx$, NULL, NULL, 'co-ex3'),
('2616c218-9c67-5530-bd06-e874e8c0aec6', '3934598e-10f7-5110-81c5-c7dddaa97df2', 20, 1, 20, $tx$Les trois élèves de l’école de Sophie Rousseau qui ont réussi l’examen du baccalauréat...
A. sont restés à l’hôpital.
B. sont allés à l’université.
C. ont arrêté leurs études.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$B$tx$, 'strict', 1, NULL, NULL, NULL, 'co-ex3'),
('a1793fa6-6bfb-5d9e-932c-9d1d2461f258', '3934598e-10f7-5110-81c5-c7dddaa97df2', 21, 2, 21, $tx$Прочитайте описания четырёх центров (материал выше) и заполните таблицу: для КАЖДОГО центра укажите по каждому критерию OUI или NON (0,5 балла за каждую верную отметку; если отмечены и «oui», и «non» — 0).

Критерии: Café internet · Cours de danse · Stage photo · Lieu (centre-ville) · Tarif (gratuit ou réductions).

Формат ответа (по строке на центр):
1. Anatole France : internet …, danse …, photo …, lieu …, tarif …
2. Jacques Prévert : …
3. Boris Vian : …
4. Victor Hugo : …

В конце ответьте: Selon les critères énoncés, quel est le centre idéal ?
(Минус 1 балл, если ответ не согласуется с вашими отметками.)$tx$, NULL, NULL, 'manual', 10, $tx$Эталонная сетка (0,5 балла за ячейку, 20 ячеек = 10 баллов):

1. Anatole France : internet NON, danse NON, photo OUI, lieu OUI, tarif NON
2. Jacques Prévert : internet OUI, danse OUI, photo NON, lieu NON, tarif OUI
3. Boris Vian : internet OUI, danse OUI, photo OUI, lieu OUI, tarif OUI
4. Victor Hugo : internet NON, danse OUI, photo NON, lieu NON, tarif NON

Centre idéal : 3. Centre Boris Vian (подтверждено corrigé).
Минус 1 балл, если названный центр не согласуется с проставленными отметками.$tx$, NULL, NULL, 'ce-ex1'),
('8ad3c3ad-f07a-577d-9f38-48b745b05178', '3934598e-10f7-5110-81c5-c7dddaa97df2', 22, 1, 22, $tx$D’après l’article, dans la vie, Alexiane...
A. forme des chiens guides.
B. élève des chiens guides.
C. promène des chiens guides.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$A$tx$, 'strict', 1, NULL, NULL, NULL, 'ce-ex2'),
('51764854-5e97-505f-a0b3-88150216944b', '3934598e-10f7-5110-81c5-c7dddaa97df2', 23, 2, 23, $tx$Vrai ou faux ? Отметьте ответ и ПРОЦИТИРУЙТЕ фразу текста, которая его подтверждает.
(1,5 балла, только если верны И выбор, И цитата; иначе 0.)

a) Au début du texte, le journaliste dit que Djengo se trouve dans un espace réservé aux chiens guides.

Формат ответа:
VRAI или FAUX
Justification : «…цитата из текста…»$tx$, NULL, NULL, 'manual', 1.5, $tx$VRAI.
Justification : « Sur une piste d’entraînement pour les chiens guides. »

Балл 1,5 — только если верны И выбор VRAI/FAUX, И цитата (эквивалентный фрагмент текста засчитывается). Иначе 0 — частичного балла у этого типа нет.$tx$, NULL, NULL, 'ce-ex2'),
('36f7d972-b90b-56c0-8b80-152d5549c90e', '3934598e-10f7-5110-81c5-c7dddaa97df2', 24, 2, 24, $tx$Vrai ou faux ? Отметьте ответ и ПРОЦИТИРУЙТЕ фразу текста, которая его подтверждает.
(1,5 балла, только если верны И выбор, И цитата; иначе 0.)

b) D’après l’article, les chiens guides aident seulement les personnes complètement aveugles.

Формат ответа:
VRAI или FAUX
Justification : «…цитата из текста…»$tx$, NULL, NULL, 'manual', 1.5, $tx$FAUX.
Justification : « un chien comme Djengo est éduqué pour accompagner une personne aveugle ou qui voit mal. »

Балл 1,5 — только если верны И выбор VRAI/FAUX, И цитата (эквивалентный фрагмент текста засчитывается). Иначе 0 — частичного балла у этого типа нет.$tx$, NULL, NULL, 'ce-ex2'),
('aa063596-ceb1-575e-b62d-c079b57a665f', '3934598e-10f7-5110-81c5-c7dddaa97df2', 25, 2, 25, $tx$Citez deux choses que le jeune chien guide apprend à ne pas faire dans sa famille d’accueil.
(Deux réponses attendues — 1 балл за каждую.)

a) …
b) …$tx$, NULL, NULL, 'manual', 2, $tx$Deux réponses parmi :
— aboyer (sans raison) ;
— monter sur les canapés ;
— entrer dans les chambres.

1 балл за каждый верный пункт.$tx$, NULL, NULL, 'ce-ex2'),
('b7d69bf6-d0c1-546d-a778-e81dafe1117b', '3934598e-10f7-5110-81c5-c7dddaa97df2', 26, 2, 26, $tx$Vrai ou faux ? Отметьте ответ и ПРОЦИТИРУЙТЕ фразу текста, которая его подтверждает.
(1,5 балла, только если верны И выбор, И цитата; иначе 0.)

Avec sa famille d’accueil, à l’extérieur de la maison, Djengo apprend à rester calme.

Формат ответа:
VRAI или FAUX
Justification : «…цитата из текста…»$tx$, NULL, NULL, 'manual', 1.5, $tx$VRAI.
Justification : « Pendant les promenades, […] il apprendra à ne pas courir après un ballon ou à ne pas avoir peur du klaxon des voitures. »

Балл 1,5 — только если верны И выбор VRAI/FAUX, И цитата (эквивалентный фрагмент текста засчитывается). Иначе 0 — частичного балла у этого типа нет.$tx$, NULL, NULL, 'ce-ex2'),
('471ea82e-d690-5e28-8fa9-06d3cd98008f', '3934598e-10f7-5110-81c5-c7dddaa97df2', 27, 1, 27, $tx$À quel âge le chien guide entre-t-il dans une école ? À...
A. 8 mois.
B. 12 mois.
C. 18 mois.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$B$tx$, 'strict', 1, NULL, NULL, NULL, 'ce-ex2'),
('7d391c3f-c442-569d-b30c-4c3e5838c89e', '3934598e-10f7-5110-81c5-c7dddaa97df2', 28, 1, 28, $tx$D’après l’article, combien d’ordres un chien guide peut-il comprendre ?
A. Entre 10 et 20.
B. Entre 20 et 40.
C. Entre 40 et 60.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$C$tx$, 'strict', 1, NULL, NULL, NULL, 'ce-ex2'),
('fd9c2888-1dbf-5636-b446-cddf4f346bb8', '3934598e-10f7-5110-81c5-c7dddaa97df2', 29, 1, 29, $tx$À l’école, on enseigne d’abord aux chiens à...
A. se diriger.
B. repérer les passages piétons.
C. s’arrêter aux portes.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$A$tx$, 'strict', 1, NULL, NULL, NULL, 'ce-ex2'),
('be98f135-9b73-56a9-b0c5-ab0680dee90e', '3934598e-10f7-5110-81c5-c7dddaa97df2', 30, 2, 30, $tx$Vrai ou faux ? Отметьте ответ и ПРОЦИТИРУЙТЕ фразу текста, которая его подтверждает.
(1,5 балла, только если верны И выбор, И цитата; иначе 0.)

D’après l’article, le chien guide n’est pas le seul à suivre une formation.

Формат ответа:
VRAI или FAUX
Justification : «…цитата из текста…»$tx$, NULL, NULL, 'manual', 1.5, $tx$VRAI.
Justification : « Son futur maître doit également faire un stage de formation. »

Балл 1,5 — только если верны И выбор VRAI/FAUX, И цитата (эквивалентный фрагмент текста засчитывается). Иначе 0 — частичного балла у этого типа нет.$tx$, NULL, NULL, 'ce-ex2'),
('e8d6951e-a4d8-5b94-b33e-5312759f9690', '3934598e-10f7-5110-81c5-c7dddaa97df2', 31, 1, 31, $tx$Grâce à son chien, Hervé se sent...
A. aimé.
B. calme.
C. confiant.

Ответ — одна буква: A, B или C.$tx$, NULL, $tx$C$tx$, 'strict', 1, NULL, NULL, NULL, 'ce-ex2'),
('e5da6f4a-6396-54e5-93ed-ffec3e3b932b', '3934598e-10f7-5110-81c5-c7dddaa97df2', 32, 1, 32, $tx$Qui permet aux écoles de chiens guides d’exister ?

Ответьте коротко по-французски.$tx$, NULL, $tx$Le grand public$tx$, 'strict', 2, $tx$Corrigé: « Le grand public ». Corrigé допускает «toute reformulation ou réponse cohérente» — если авто-проверка дала 0 при осмысленном ответе, поставьте балл вручную.$tx$, NULL, NULL, 'ce-ex2'),
('46a4a1d6-05c8-561b-818a-0fe824539917', '3934598e-10f7-5110-81c5-c7dddaa97df2', 33, 2, 33, $tx$PRODUCTION ÉCRITE (160 mots minimum)

Vous recevez ce message d’un ami :

« Salut !
Je sais que tu as étudié en France l’année dernière. Moi aussi, je pense partir étudier dans un pays étranger mais j’hésite… Je voudrais savoir ce que tu en penses. Quelle a été ton expérience ? D’après toi, est-ce que c’est une bonne idée de faire ses études dans un autre pays ? Merci d’avance pour ta réponse !
À bientôt, Fabien »

Vous répondez à Fabien. (160 mots minimum)$tx$, NULL, NULL, 'manual', 25, $tx$Оценивание по официальной grille PE DELF B1 — 5 критериев, каждый 0 / 1 / 3 / 5 (максимум 25):
1. Réalisation de la tâche — текст связный, отвечает заданию, мнение с примерами.
2. Cohérence et cohésion — логичная последовательность, связки.
3. Adéquation sociolinguistique — регистр дружеского письма.
4. Lexique — достаточный словарь уровня B1.
5. Morphosyntaxe — грамматика B1.

Правила длины (из corrigé):
— 113–143 слова → 0,5 из 1 за критерий длины;
— менее 113 слов → 0 за критерий длины;
— менее 79 слов (≈50 %) → 0 за ВСЁ задание («manque de matière évaluable»).

Аномалии (grille): hors-sujet thématique / discursif / complet, copie blanche — см. официальную grille. Итог выставляет преподаватель.$tx$, NULL, NULL, NULL),
('d5507c4e-abf9-55ee-9388-d5e81eabf154', '3934598e-10f7-5110-81c5-c7dddaa97df2', 34, 2, 34, $tx$EXERCICE 1 — ENTRETIEN DIRIGÉ (sans préparation, 2 à 3 minutes)

Vous parlez de vous, de vos activités, de vos centres d’intérêt. Vous parlez de votre passé, de votre présent et de vos projets.

L’épreuve se déroule sur le mode d’un entretien avec l’examinateur qui amorcera le dialogue par une question (exemples : « Bonjour... pouvez-vous vous présenter, me parler de vous, de votre famille... ? »).

⚠ Отвечать здесь ничего не нужно — эта часть сдаётся устно на занятии.$tx$, NULL, NULL, 'manual', 6, $tx$Оценивается устно на занятии. Grille PO: réalisation de la tâche (entretien) 0 / 1 / 2,5 / 4 + доля лингвистических критериев (lexique, morphosyntaxe, phonologie — общие на все три части). Балл выставляет преподаватель вручную.$tx$, NULL, NULL, 'po'),
('959d8263-37b7-5c71-a7f7-d5f3b9ffe117', '3934598e-10f7-5110-81c5-c7dddaa97df2', 35, 2, 35, $tx$EXERCICE 2 — EXERCICE EN INTERACTION (sans préparation, 3 à 4 minutes)

Vous jouez le rôle qui vous est indiqué sur le document que vous avez choisi parmi les deux tirés au sort.

⚠ Sujet вытягивается на занятии; отвечать здесь ничего не нужно.$tx$, NULL, NULL, 'manual', 7, $tx$Оценивается устно на занятии. Grille PO: réalisation de la tâche (interaction) 0 / 1 / 2,5 / 4 + доля лингвистических критериев. Балл выставляет преподаватель вручную.$tx$, NULL, NULL, 'po'),
('9a26eedf-d41d-5128-857c-9a790e8e54fd', '3934598e-10f7-5110-81c5-c7dddaa97df2', 36, 2, 36, $tx$EXERCICE 3 — EXPRESSION D’UN POINT DE VUE (préparation 10 minutes, 5 à 7 minutes)

Vous dégagez le thème soulevé par le document que vous avez choisi parmi les deux tirés au sort et vous présentez votre opinion sous la forme d’un exposé personnel de 3 minutes environ. L’examinateur pourra vous poser quelques questions.

⚠ Документ вытягивается на занятии; отвечать здесь ничего не нужно.$tx$, NULL, NULL, 'manual', 12, $tx$Оценивается устно на занятии. Grille PO: réalisation de la tâche (point de vue) 0 / 1 / 2,5 / 4 + лингвистические критерии (на все три части: lexique до 4, morphosyntaxe до 5, phonologie до 4 — суммарно grille даёт /25). Балл выставляет преподаватель вручную.$tx$, NULL, NULL, 'po')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Validation:
-- SELECT part, count(*), sum(max_score) FROM mock_exam_variant_tasks WHERE variant_id='3934598e-10f7-5110-81c5-c7dddaa97df2' GROUP BY part;
-- Жду: part1 -> 25 задач / 30 б.; part2 -> 11 задач / 70 б.
-- Откат: DELETE FROM mock_exam_variant_tasks WHERE variant_id='3934598e-10f7-5110-81c5-c7dddaa97df2'; DELETE FROM mock_exam_variants WHERE id='3934598e-10f7-5110-81c5-c7dddaa97df2';
