/**
 * @file App.tsx
 * @description 应用主入口，路由管理
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './hooks/user/useAuth';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HealthProfilePage from './pages/HealthProfilePage';
import './i18n';
import './App.css';

// 页面类型
type PageType = 'login' | 'register' | 'healthProfile' | 'home';

/**
 * 应用主组件
 */
function App() {
  const { i18n } = useTranslation();
  const { isAuthenticated, isLoading, user } = useAuth();
  const [currentPage, setCurrentPage] = useState<PageType>('login');

  /**
   * 切换语言
   */
  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  // 加载中
  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner">💊</div>
        <p>加载中...</p>
      </div>
    );
  }

  // 未登录：显示登录/注册页面
  if (!isAuthenticated) {
    return (
      <div className="app">
        {/* 语言切换按钮 */}
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

  // 已登录：显示健康档案或主页
  return (
    <div className="app">
      {/* 语言切换按钮 */}
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

      {currentPage === 'healthProfile' ? (
        <HealthProfilePage
          onComplete={() => setCurrentPage('home')}
        />
      ) : (
        <div className="home-page">
          <h1>🏠 欢迎, {user?.displayName || '用户'}!</h1>
          <p>健康档案已完成，可以开始使用用药助手了。</p>
          <button
            className="primary-button"
            onClick={() => setCurrentPage('healthProfile')}
          >
            编辑健康档案
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
