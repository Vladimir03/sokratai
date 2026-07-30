/**
 * Единая точка входа просмотра фото. Все поверхности кабинета импортируют
 * отсюда — чтобы копий карусели снова не стало четыре.
 */

export { PhotoViewer, type PhotoViewerItem, type PhotoViewerProps } from './PhotoViewer';
export { SafeImage, type SafeImageProps } from './SafeImage';
export { usePhotoViewer, type UsePhotoViewerResult } from './usePhotoViewer';
export { PhotoThumbButton, type PhotoThumbButtonProps } from './PhotoThumbButton';
export { useQuarterTurnFit } from './useQuarterTurnFit';
export { OrientedPhoto, type OrientedPhotoProps } from './OrientedPhoto';
