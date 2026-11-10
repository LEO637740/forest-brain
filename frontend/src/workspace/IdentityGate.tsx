import {useEffect, useState} from 'react';
import {Leaf, LogIn, ShieldCheck} from 'lucide-react';
import {IDENTITY_STORAGE_KEY, post, useRead} from '../integration/client';
import {WorkspaceApp} from './WorkspaceApp';
import {parseSignedIn, roleIntro, roleOrder, type DemoAccount, type SignedIn} from './identityModel';
import './identity.css';

type Accounts = {items:DemoAccount[];authentication:string;requireIdentity:boolean};

export function IdentityGate({onSignedIn}:{onSignedIn:(value:SignedIn)=>void}) {
  const accounts = useRead<Accounts>('/api/auth/accounts');
  const [busy, setBusy] = useState<string|null>(null), [error, setError] = useState('');
  async function login(account:DemoAccount) {
    setBusy(account.accountId); setError('');
    try {
      const identity = await post<SignedIn>('/api/auth/login', {accountId:account.accountId});
      location.hash = 'workbench';
      onSignedIn(identity);
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  return <main className="id-page" aria-labelledby="id-title">
    <header className="id-head"><Leaf size={30}/><div><p>橡胶大脑 · 胶林大模型</p><h1 id="id-title">选择你的身份</h1>
      <span>按岗位进入工作台，查看相关待办与数据。</span></div></header>
    {accounts.error && <p className="id-error" role="alert">身份列表读取失败：{accounts.error} <button className="rb-button" onClick={accounts.reload}>重试</button></p>}
    {!accounts.data && !accounts.error && <p role="status">正在读取演示身份…</p>}
    {accounts.data && <div className="id-roles">{roleOrder.map(role => {
      const items = accounts.data!.items.filter(item => item.role === role);
      if (!items.length) return null;
      return <section key={role} className={`id-role id-role-${role}`} aria-label={roleIntro[role].title}>
        <header><h2>{roleIntro[role].title}</h2><p>{roleIntro[role].text}</p></header>
        {items.map(account => <button key={account.accountId} className="id-account" disabled={busy !== null} onClick={() => login(account)}>
          <span><strong>{account.name}</strong><small>{account.title}</small><em>{account.plot ? account.plot.label : account.summary}</em></span>
          {busy === account.accountId ? <span role="status">正在进入…</span> : <LogIn size={18}/>}
        </button>)}
      </section>;
    })}</div>}
    {error && <p className="id-error" role="alert">{error}</p>}
    <footer className="id-foot"><ShieldCheck size={16}/>演示环境 · 选择身份即可进入</footer>
  </main>;
}

/** Root of the workspace: restores the saved identity or asks for one. */
export function IdentityRoot() {
  const [signedIn, setSignedIn] = useState<SignedIn|null>(() => { try { return parseSignedIn(localStorage.getItem(IDENTITY_STORAGE_KEY)); } catch { return null; } });
  const save = (value:SignedIn|null) => {
    try { if (value) localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(value)); else localStorage.removeItem(IDENTITY_STORAGE_KEY); } catch { /* the in-memory identity still works for this tab */ }
    setSignedIn(value);
  };
  useEffect(() => {
    const expired = () => save(null);
    window.addEventListener('harness-login-required', expired);
    return () => window.removeEventListener('harness-login-required', expired);
  }, []);
  async function logout() {
    try { await post('/api/auth/logout', {}); } catch { /* local sign-out still applies */ }
    save(null);
  }
  if (!signedIn) return <IdentityGate onSignedIn={save}/>;
  return <WorkspaceApp key={signedIn.account.accountId} account={signedIn.account} onLogout={logout}/>;
}
