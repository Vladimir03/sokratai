/**
 * «Разобрать на доске» — второй путь из решения владельца (волна 2).
 *
 * Быстрая разметка во вьюере закрывает 90% случаев («обвёл ошибку и отправил»).
 * Но когда нужно расписать решение РЯДОМ с фото, места поверх снимка не хватает
 * — и тогда фото уезжает на доску, где есть весь арсенал и совместная работа.
 * Ровно этот путь Ульяна проделывала руками.
 *
 * ⚠️ Доска создаётся ОТДЕЛЬНАЯ, не привязанная к занятию: тред ДЗ не знает про
 * урок, и заставлять репетитора выбирать его посреди проверки — лишний шаг.
 * Занятие при необходимости привязывается потом, в самой доске.
 *
 * ⚠️ Поворот ЗАПЕКАЕТСЯ в файл перед загрузкой. Альтернатива — положить угол в
 * `ImageElement.rotation` — сломала бы вписывание: рамка элемента остаётся
 * неповёрнутой, и портрет, развёрнутый на 90°, вылез бы за края листа.
 */

import { createBoard, createBoardPage } from '@/lib/whiteboardApi';
import { uploadBoardImage } from '@/lib/whiteboard/boardImages';
import { PAGE_WIDTH_MM, createImage } from '@/lib/whiteboard/model';
import { type PhotoDegrees } from '@/lib/photoOrientation';
import { renderAnnotatedPhoto } from './renderAnnotatedPhoto';

export interface SendPhotoToBoardInput {
  photoUrl: string;
  degrees: PhotoDegrees;
  /** Имя ученика для заголовка доски. */
  studentName?: string | null;
}

/** Возвращает id созданной доски — вызывающий делает навигацию. */
export async function sendPhotoToBoard({
  photoUrl,
  degrees,
  studentName,
}: SendPhotoToBoardInput): Promise<string> {
  // Ноль элементов — просто «выпрямить» фото в пиксели тем же кодом, что
  // собирает размеченную картинку.
  const file = await renderAnnotatedPhoto({
    photoUrl,
    degrees,
    elements: [],
    fileName: 'foto-uchenika.jpg',
  });

  const title = studentName ? `Разбор ДЗ · ${studentName}` : 'Разбор ДЗ';
  const board = await createBoard({ title });

  const uploaded = await uploadBoardImage(file, board.board.id);
  const heightMm =
    uploaded.naturalWidth > 0
      ? (PAGE_WIDTH_MM * uploaded.naturalHeight) / uploaded.naturalWidth
      : PAGE_WIDTH_MM;

  // Порядок как у PDF-импорта: сначала загрузка, потом лист СРАЗУ с элементом.
  // При обрыве сети остаётся осиротевший файл, а не пустой лист у репетитора.
  await createBoardPage(board.board.id, {
    background: 'blank',
    grid_mm: 5,
    elements: [createImage(0, 0, PAGE_WIDTH_MM, heightMm, uploaded.ref)],
  });

  return board.board.id;
}
