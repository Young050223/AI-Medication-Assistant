/**
 * @file App.tsx
 * @description 应用主入口，路由管理 — 4-Tab 导航架构
 * @preserve 保留所有 useAuth、feedback、record 等业务逻辑
 */

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './hooks/user/useAuth';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HealthProfilePage from './pages/HealthProfilePage';
import MedicalRecordUploadPage from './pages/MedicalRecordUploadPage';
import MedicationSchedulePage from './pages/MedicationSchedulePage';
import MedicationFeedbackPage from './pages/MedicationFeedbackPage';
import LandingPage from './pages/LandingPage';
import AgentChatPage from './pages/AgentChatPage';
import SettingsPage from './pages/SettingsPage';
import BottomNavBar, { type NavItem } from './components/BottomNavBar';
import type { ExtractedMedication } from './types/MedicalRecord.types';
import './i18n';
import { IconPill } from './components/Icons';
import './App.css';

// 页面类型
type PageType = 'login' | 'register' | 'healthProfile' | 'landing'
  | 'uploadRecord' | 'schedules' | 'feedback' | 'agent' | 'settings';

/**
 * 应用主组件
 */
function App() {
  const { t } = useTranslation();
  const { isLoading, user, logout } = useAuth();
  const [currentPage, setCurrentPage] = useState<PageType>('login');
  const [currentTab, setCurrentTab] = useState<NavItem>('home');
  // 反馈页面预选数据
  const [feedbackMedication, setFeedbackMedication] = useState<string | undefined>();
  const [feedbackScheduleId, setFeedbackScheduleId] = useState<string | undefined>();

  // 初始化主题
  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setCurrentPage('login');
  }, [logout]);

  const handleRecordComplete = useCallback((medications: ExtractedMedication[]) => {
    console.log('[App] 识别到的药物:', medications);
    setCurrentPage('landing');
    setCurrentTab('home');
  }, []);

  /**
   * 底部导航 Tab 切换
   */
  const handleTabChange = useCallback((tab: NavItem) => {
    setCurrentTab(tab);
    switch (tab) {
      case 'home':
        setCurrentPage('landing');
        break;
      case 'agent':
        setCurrentPage('agent');
        break;
      case 'schedule':
        setCurrentPage('schedules');
        break;
      case 'me':
        setCurrentPage('settings');
        break;
    }
  }, []);

  // 加载中
  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner"><IconPill size={32} /></div>
        <p>{t('app.loading')}</p>
      </div>
    );
  }

  // 未登录
  if (!user || currentPage === 'login' || currentPage === 'register') {
    return (
      <div className="app">
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

  // 主 Tab 页面
  const showBottomNav = ['landing', 'agent', 'schedules', 'settings'].includes(currentPage);

  return (
    <div className="app">
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
            setCurrentTab('schedule');
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
          }}
          onNavigateToSchedules={() => {
            setCurrentPage('schedules');
            setCurrentTab('schedule');
          }}
          onNavigateToAgentAnalysis={() => {
            setCurrentPage('agent');
            setCurrentTab('agent');
          }}
          onLogout={handleLogout}
          onNavigateToFeedback={(medicationName: string, scheduleId: string) => {
            setFeedbackMedication(medicationName);
            setFeedbackScheduleId(scheduleId);
            setCurrentPage('feedback');
          }}
        />
      )}

      {currentPage === 'agent' && (
        <AgentChatPage
          onNavigateToUpload={() => {
            setCurrentPage('uploadRecord');
          }}
        />
      )}

      {currentPage === 'settings' && (
        <SettingsPage
          onNavigateToHealthProfile={() => {
            setCurrentPage('healthProfile');
          }}
          onLogout={handleLogout}
        />
      )}

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
