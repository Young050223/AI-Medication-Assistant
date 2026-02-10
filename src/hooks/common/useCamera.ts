/**
 * @file useCamera.ts
 * @description 相机拍照 Hook
 * @author AI用药助手开发团队
 * @created 2026-02-03
 */

import { useState, useCallback } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export interface UseCameraReturn {
    photo: string | null;
    imageUri: string | null;
    isLoading: boolean;
    isCapturing: boolean;
    error: string | null;
    takePhoto: () => Promise<string | null>;
    selectFromGallery: () => Promise<string | null>;
    pickFromGallery: () => Promise<string | null>;
    clearPhoto: () => void;
    clearImage: () => void;
}

/**
 * 相机拍照 Hook
 */
export function useCamera(): UseCameraReturn {
    const [photo, setPhoto] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * 拍照
     */
    const takePhoto = useCallback(async (): Promise<string | null> => {
        setIsLoading(true);
        setError(null);

        try {
            const image = await Camera.getPhoto({
                quality: 90,
                allowEditing: false,
                resultType: CameraResultType.Base64,
                source: CameraSource.Camera,
            });

            const base64Image = `data:image/${image.format};base64,${image.base64String}`;
            setPhoto(base64Image);
            return base64Image;
        } catch (err: any) {
            console.error('[useCamera] Take photo error:', err);
            if (err.message !== 'User cancelled photos app') {
                setError('拍照失败');
            }
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * 从相册选择
     */
    const selectFromGallery = useCallback(async (): Promise<string | null> => {
        setIsLoading(true);
        setError(null);

        try {
            const image = await Camera.getPhoto({
                quality: 90,
                allowEditing: false,
                resultType: CameraResultType.Base64,
                source: CameraSource.Photos,
            });

            const base64Image = `data:image/${image.format};base64,${image.base64String}`;
            setPhoto(base64Image);
            return base64Image;
        } catch (err: any) {
            console.error('[useCamera] Select from gallery error:', err);
            if (err.message !== 'User cancelled photos app') {
                setError('选择照片失败');
            }
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    /**
     * 清除照片
     */
    const clearPhoto = useCallback(() => {
        setPhoto(null);
        setError(null);
    }, []);

    return {
        photo,
        imageUri: photo, // 别名
        isLoading,
        isCapturing: isLoading, // 别名
        error,
        takePhoto,
        selectFromGallery,
        pickFromGallery: selectFromGallery, // 别名
        clearPhoto,
        clearImage: clearPhoto, // 别名
    };
}

export default useCamera;
