/**
 * @file App.tsx
 * @description 应用主入口，路由管理
 * @author AI用药助手开发团队
 * @created 2026-01-17
 * @modified 2026-01-28
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './hooks/user/useAuth';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HealthProfilePage from './pages/HealthProfilePage';
import MedicalRecordUploadPage from './pages/MedicalRecordUploadPage';
import MedicationSchedulePage from './pages/MedicationSchedulePage';
import MedicationFeedbackPage from './pages/MedicationFeedbackPage';
import LandingPage from './pages/LandingPage';
import BottomNavBar, { type NavItem } from './components/BottomNavBar';
import type { ExtractedMedication } from './types/MedicalRecord.types';
import './i18n';
import './App.css';

// 页面类型
type PageType = 'login' | 'register' | 'healthProfile' | 'landing' | 'uploadRecord' | 'schedules' | 'profile' | 'feedback';

/**
 * 应用主组件
 */
function App() {
  const { t, i18n } = useTranslation();
  const { isLoading, user, logout } = useAuth();
  // 暂时跳过登录，默认进入首页（开发模式）
  const [currentPage, setCurrentPage] = useState<PageType>('landing');
  const [currentTab, setCurrentTab] = useState<NavItem>('home');
  // 反馈页面所需的预选数据
  const [feedbackMedication, setFeedbackMedication] = useState<string | undefined>();
  const [feedbackScheduleId, setFeedbackScheduleId] = useState<string | undefined>();

  /**
   * 处理登出
   */
  const handleLogout = useCallback(async () => {
    await logout();
    setCurrentPage('login');
  }, [logout]);

  /**
   * 切换语言
   */
  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  /**
   * 处理病例识别完成
   */
  const handleRecordComplete = useCallback((medications: ExtractedMedication[]) => {
    console.log('[App] 识别到的药物:', medications);
    // TODO: 保存到本地存储，创建服药计划
    setCurrentPage('landing');
    setCurrentTab('home');
  }, []);

  /**
   * 处理底部导航栏Tab切换
   */
  const handleTabChange = useCallback((tab: NavItem) => {
    setCurrentTab(tab);
    switch (tab) {
      case 'home':
        setCurrentPage('landing');
        break;
      case 'records':
        setCurrentPage('uploadRecord');
        break;
      case 'reminders':
        setCurrentPage('schedules');
        break;
      case 'profile':
        setCurrentPage('profile');
        break;
    }
  }, []);

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

  // 开发模式：只在用户明确选择登录/注册页面时才显示（暂时跳过认证检查）
  if (currentPage === 'login' || currentPage === 'register') {
    return (
      <div className="app">
        <LanguageSwitcher />
        {currentPage === 'register' ? (
          <RegisterPage
            onNavigateToLogin={() => setCurrentPage('login')}
            onRegisterSuccess={() => {
              console.log('[App] 注册成功，跳转到健康档案');
              setCurrentPage('healthProfile');
            }}
          />
        ) : (
          <LoginPage
            onNavigateToRegister={() => setCurrentPage('register')}
            onLoginSuccess={() => {
              setCurrentPage('landing');
              setCurrentTab('home');
            }}
          />
        )}
      </div>
    );
  }

  // 判断是否显示底部导航栏（在主要页面显示，详情页不显示）
  const showBottomNav = ['landing', 'uploadRecord', 'schedules', 'profile'].includes(currentPage);

  // 已登录：根据页面类型显示不同内容
  return (
    <div className="app">
      <LanguageSwitcher />

      {currentPage === 'healthProfile' && (
        <HealthProfilePage
          onComplete={() => {
            setCurrentPage('landing');
            setCurrentTab('home');
          }}
        />
      )}

      {currentPage === 'uploadRecord' && (
        <MedicalRecordUploadPage
          onComplete={handleRecordComplete}
          onBack={() => {
            setCurrentPage('landing');
            setCurrentTab('home');
          }}
        />
      )}

      {currentPage === 'schedules' && (
        <MedicationSchedulePage
          onBack={() => {
            setCurrentPage('landing');
            setCurrentTab('home');
          }}
          onNavigateToFeedback={(medicationName: string, scheduleId: string) => {
            setFeedbackMedication(medicationName);
            setFeedbackScheduleId(scheduleId);
            setCurrentPage('feedback');
          }}
        />
      )}

      {currentPage === 'feedback' && (
        <MedicationFeedbackPage
          onBack={() => {
            setCurrentPage('schedules');
            setCurrentTab('reminders');
            setFeedbackMedication(undefined);
            setFeedbackScheduleId(undefined);
          }}
          preselectedMedication={feedbackMedication}
          preselectedScheduleId={feedbackScheduleId}
        />
      )}

      {currentPage === 'landing' && (
        <LandingPage
          userName={user?.displayName || undefined}
          onNavigateToUpload={() => {
            setCurrentPage('uploadRecord');
            setCurrentTab('records');
          }}
          onNavigateToSchedules={() => {
            setCurrentPage('schedules');
            setCurrentTab('reminders');
          }}
          onNavigateToProfile={() => {
            setCurrentPage('healthProfile');
          }}
          onLogout={handleLogout}
        />
      )}

      {currentPage === 'profile' && (
        <HealthProfilePage
          onComplete={() => {
            setCurrentPage('landing');
            setCurrentTab('home');
          }}
        />
      )}

      {/* 底部导航栏 */}
      {showBottomNav && (
        <BottomNavBar
          currentTab={currentTab}
          onTabChange={handleTabChange}
        />
      )}
    </div>
  );
}

export default App;
