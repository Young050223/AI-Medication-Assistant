/**
 * @file App.tsx
 * @description 应用主入口，路由管理 - M1和M2验证版本
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-18
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './hooks/user/useAuth';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HealthProfilePage from './pages/HealthProfilePage';
// M3和M4暂时禁用，仅验证M1和M2
// import MedicalRecordUploadPage from './pages/MedicalRecordUploadPage';
// import MedicationSchedulePage from './pages/MedicationSchedulePage';
// import type { ExtractedMedication } from './types/MedicalRecord.types';
import './i18n';
import './App.css';

// 页面类型 - 仅M1和M2
type PageType = 'login' | 'register' | 'healthProfile' | 'home';

/**
 * 应用主组件
 */
function App() {
  const { t, i18n } = useTranslation();
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const [currentPage, setCurrentPage] = useState<PageType>('login');

  /**
   * 切换语言
   */
  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  /**
   * 处理登出
   */
  const handleLogout = useCallback(async () => {
    await logout();
    setCurrentPage('login');
  }, [logout]);

  // 语言切换组件
  const LanguageSwitcher = () => (
    <div className="language-switcher">
      <button
        className={`lang-btn ${i18n.language === 'zh-CN' ? 'active' : ''}`}
        onClick={() => handleLanguageChange('zh-CN')}
      >
        简
      </button>
      <button
        className={`lang-btn ${i18n.language === 'zh-TW' ? 'active' : ''}`}
        onClick={() => handleLanguageChange('zh-TW')}
      >
        繁
      </button>
      <button
        className={`lang-btn ${i18n.language === 'en' ? 'active' : ''}`}
        onClick={() => handleLanguageChange('en')}
      >
        EN
      </button>
    </div>
  );

  // 加载中
  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner">💊</div>
        <p>{t('app.loading')}</p>
      </div>
    );
  }

  // 未登录：显示登录/注册页面
  if (!isAuthenticated) {
    return (
      <div className="app">
        <LanguageSwitcher />
        {currentPage === 'login' ? (
          <LoginPage
            onNavigateToRegister={() => setCurrentPage('register')}
            onLoginSuccess={() => setCurrentPage('healthProfile')}
          />
        ) : (
          <RegisterPage
            onNavigateToLogin={() => setCurrentPage('login')}
            onRegisterSuccess={() => setCurrentPage('healthProfile')}
          />
        )}
      </div>
    );
  }

  // 已登录：根据页面类型显示不同内容
  return (
    <div className="app">
      <LanguageSwitcher />

      {currentPage === 'healthProfile' && (
        <HealthProfilePage
          onComplete={() => setCurrentPage('home')}
        />
      )}

      {currentPage === 'home' && (
        <div className="home-page">
          <h1>🏠 {t('app.welcome', { name: user?.displayName || t('app.user') })}</h1>
          <p>{t('app.homeDescription')}</p>

          {/* M1和M2验证完成后的主页 */}
          <div className="home-actions">
            <button
              className="action-button"
              onClick={() => setCurrentPage('healthProfile')}
            >
              <span className="icon">👤</span>
              <span className="label">{t('app.editProfile')}</span>
            </button>
          </div>

          {/* 登出按钮 */}
          <button className="logout-button" onClick={handleLogout}>
            {t('auth.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
