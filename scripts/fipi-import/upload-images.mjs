// Загрузка картинок задач ФИПИ в бакет kb-attachments (пилот «ФИПИ ОГЭ · стр. 1»).
//
// Запуск (из корня репозитория C:\Users\kamch\sokratai):
//     node scripts/fipi-import/upload-images.mjs
// Скрипт спросит твой email и пароль от Сократа прямо в терминале (пароль скрыт).
// Пароль никуда не сохраняется и не логируется.
//
// Политика бакета: первый сегмент пути обязан быть auth.uid() загружающего,
// поэтому файлы ложатся в {uid}/fipi-oge/p1/. Читать их может любой authenticated
// (SELECT-политика kb-attachments), так что задачи Егора спокойно ссылаются на эти refs.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

// RU-bypass: только api.sokratai.ru, никогда *.supabase.co (AGENTS.md → Network & RU bypass).
const SUPABASE_URL = 'https://api.sokratai.ru';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      // Скрываем ввод пароля: печатаем '*' вместо символов.
      rl._writeToOutput = (str) => {
        if (str.includes(question)) rl.output.write(str);
        else rl.output.write('*');
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) rl.output.write('\n');
      resolve(answer.trim());
    });
  });
}

const email = process.env.SOKRAT_EMAIL || (await ask('Email в Сократе: '));
const password = process.env.SOKRAT_PASSWORD || (await ask('Пароль: ', { hidden: true }));
if (!email || !password) {
  console.error('Нужны email и пароль.');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const imagesDir = join(here, 'out', 'images', 'p1');
const refsOut = join(here, 'out', 'refs.json');

const supabase = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
if (authErr) {
  console.error('\nНе удалось войти:', authErr.message);
  console.error('Если входишь через Яндекс / VK / Google (без пароля) — напиши мне, загрузим иначе.');
  process.exit(1);
}
const uid = auth.user.id;
console.log('\nВход выполнен, uid =', uid);

const files = readdirSync(imagesDir).filter((f) => MIME[f.split('.').pop().toLowerCase()]);
if (files.length === 0) {
  console.error('В', imagesDir, 'нет картинок.');
  process.exit(1);
}

const refs = {};
let failed = 0;
for (const file of files) {
  const ext = file.split('.').pop().toLowerCase();
  const path = `${uid}/fipi-oge/p1/${file}`;
  const body = readFileSync(join(imagesDir, file));
  const { error } = await supabase.storage
    .from('kb-attachments')
    .upload(path, body, { contentType: MIME[ext], upsert: true });
  if (error) {
    failed += 1;
    console.error('FAIL', file, '→', error.message);
    continue;
  }
  const ref = `storage://kb-attachments/${path}`;
  refs[file.replace(/\.[^.]+$/, '')] = ref;
  console.log('OK  ', file, '→', ref);
}

writeFileSync(refsOut, JSON.stringify({ uid, refs }, null, 2));
console.log(`\nГотово: ${files.length - failed}/${files.length} загружено.`);
console.log(`Соответствие картинок сохранено в ${refsOut}`);
console.log('Пришли мне содержимое этого файла (refs.json) — я подставлю ссылки в задачи.');
if (failed > 0) process.exit(2);
