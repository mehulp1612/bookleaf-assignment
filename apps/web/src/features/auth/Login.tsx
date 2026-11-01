import { useState, useRef, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { endpoints, loginRequestSchema } from '@bookleaf/contracts';
import { request } from '../../shared/api';
import { ErrorNotice } from '../../shared/ui';
import { useSession } from './session';

export function Login() {
  const { acceptLogin, draft, expired } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [validation, setValidation] = useState('');
  const busy = useRef(false);
  const mutation = useMutation({
    mutationFn: async () => {
      const input = loginRequestSchema.parse({ email, password });
      const response = await request('/api/v1/auth/login', endpoints.login.response, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      await acceptLogin(response.data);
    },
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const result = loginRequestSchema.safeParse({ email, password });
    if (!result.success) {
      setValidation('Enter a valid email address and your password.');
      return;
    }
    setValidation('');
    busy.current = true;
    try {
      await mutation.mutateAsync();
    } catch {
      /* The mutation renders its safe error. */
    } finally {
      busy.current = false;
      setPassword('');
    }
  }
  return (
    <section className="login-layout">
      <div className="login-story">
        <p className="eyebrow">BOOKLEAF AUTHOR SUPPORT</p>
        <h1>
          Your stories.
          <br />
          Our support.
        </h1>
        <p className="intro">A home for your books and the conversations that help them grow.</p>
        <div className="story-note">
          Publication details, royalty snapshots, and a direct line to your support team.
        </div>
      </div>
      <div className="panel login-panel">
        <h2>Welcome back</h2>
        <p className="muted">Sign in with your BookLeaf author account.</p>
        {(draft || expired) && (
          <p className="notice" role="status">
            Your session has ended. Sign in again to continue.{' '}
            {draft && 'Your unsent question is kept in this tab for the same account.'}
          </p>
        )}
        <form onSubmit={(e) => void submit(e)}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            disabled={mutation.isPending}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            disabled={mutation.isPending}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {validation && (
            <p role="alert" className="field-error">
              {validation}
            </p>
          )}
          {mutation.error && <ErrorNotice error={mutation.error} />}
          <button className="wide" disabled={mutation.isPending}>
            {mutation.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="small muted">
          Use the account details supplied with your demo or by your publishing team.
        </p>
      </div>
    </section>
  );
}
