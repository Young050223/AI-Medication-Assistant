/**
 * @file useCamera.ts
 * @description 相机Hook，提供iOS原生拍照和相册选择功能
 * @author AI用药助手开发团队
 * @created 2026-01-18
 * @modified 2026-01-18
 */

import { useState, useCallback } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import type { UseCameraReturn } from '../../types/MedicalRecord.types';

/**
 * 相机Hook
 * 提供iOS原生拍照和相册选择功能
 * 
 * @returns {UseCameraReturn} 相机状态和方法
 * 
 * @example
 * const { imageUri, takePhoto, pickFromGallery } = useCamera();
 * 
 * // 拍照
 * const uri = await takePhoto();
 * 
 * // 从相册选择
 * const uri = await pickFromGallery();
 */
export function useCamera(): UseCameraReturn {
    // 状态
    const [imageUri, setImageUri] = useState<string | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * 拍照
     * 使用iOS原生相机拍摄照片
     * @returns 图片URI或null
     */
    const takePhoto = useCallback(async (): Promise<string | null> => {
        try {
            setError(null);
            setIsCapturing(true);

            // 请求相机权限并拍照
            const image = await Camera.getPhoto({
                quality: 90,
                allowEditing: false,
                resultType: CameraResultType.Uri,
                source: CameraSource.Camera,
                // 针对病例拍摄优化
                width: 1920,
                height: 2560,
                correctOrientation: true,
            });

            const uri = image.webPath || null;
            setImageUri(uri);
            console.log('[useCamera] 拍照成功:', uri);

            return uri;
        } catch (err: any) {
            // 用户取消不算错误
            if (err.message?.includes('User cancelled')) {
                console.log('[useCamera] 用户取消拍照');
                return null;
            }

            console.error('[useCamera] 拍照失败:', err);
            setError(err.message || '拍照失败');
            return null;
        } finally {
            setIsCapturing(false);
        }
    }, []);

    /**
     * 从相册选择图片
     * @returns 图片URI或null
     */
    const pickFromGallery = useCallback(async (): Promise<string | null> => {
        try {
            setError(null);
            setIsCapturing(true);

            // 从相册选择
            const image = await Camera.getPhoto({
                quality: 90,
                allowEditing: false,
                resultType: CameraResultType.Uri,
                source: CameraSource.Photos,
            });

            const uri = image.webPath || null;
            setImageUri(uri);
            console.log('[useCamera] 选择图片成功:', uri);

            return uri;
        } catch (err: any) {
            // 用户取消不算错误
            if (err.message?.includes('User cancelled')) {
                console.log('[useCamera] 用户取消选择');
                return null;
            }

            console.error('[useCamera] 选择图片失败:', err);
            setError(err.message || '选择图片失败');
            return null;
        } finally {
            setIsCapturing(false);
        }
    }, []);

    /**
     * 清除已选图片
     */
    const clearImage = useCallback(() => {
        setImageUri(null);
    }, []);

    /**
     * 清除错误
     */
    const clearError = useCallback(() => {
        setError(null);
    }, []);

    return {
        imageUri,
        isCapturing,
        error,
        takePhoto,
        pickFromGallery,
        clearImage,
        clearError,
    };
}

export default useCamera;
