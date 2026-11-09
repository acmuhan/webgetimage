// Cap 人机验证组件（https://capjs.js.org）的 React 封装
// 组件自带中文界面（随浏览器语言切换）
import './cap-config.js'; // 必须排在 cap-widget 之前
import 'cap-widget';
import { useEffect, useRef } from 'react';

export default function CapWidget({ onSolve, onError, resetKey }) {
  const ref = useRef(null);
  const handlers = useRef({ onSolve, onError });
  handlers.current = { onSolve, onError };

  useEffect(() => {
    const el = ref.current;
    const solve = (e) => handlers.current.onSolve?.(e.detail.token);
    const error = (e) => handlers.current.onError?.(e.detail?.message || '人机验证失败');
    el.addEventListener('solve', solve);
    el.addEventListener('error', error);
    return () => {
      el.removeEventListener('solve', solve);
      el.removeEventListener('error', error);
    };
  }, []);

  // resetKey 变化时重置组件，令牌是一次性的，失败后需要重新验证
  useEffect(() => {
    if (resetKey) ref.current?.reset?.();
  }, [resetKey]);

  return (
    <cap-widget ref={ref} data-cap-api-endpoint="/cap/" />
  );
}
