import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { QueryClientProvider, useMutation, useIsMutating } from '@tanstack/react-query';
import { createQueryClient } from './shared/queries';
import { ErrorNotice, Loading } from './shared/ui';
import { SessionProvider, useSession } from './features/auth/session';
import { Login } from './features/auth/Login';
import { Books } from './features/books/Books';
import { TicketForm } from './features/author-tickets/TicketForm';
import { Tickets, TicketDetail } from './features/author-tickets/Tickets';
import { AdminQueue } from './features/admin-tickets/Queue';
import { AdminTicket } from './features/admin-tickets/Detail';
import './styles.css';

function App() {
  const { session, logout } = useSession();
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const signout = useMutation({ mutationFn: logout });
  const activeMutations = useIsMutating();
  useEffect(() => {
    main.current?.focus();
    window.scrollTo(0, 0);
  }, [location.pathname]);
  const user = session.data;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header>
        <Link className="brand" to="/" aria-label="BookLeaf home">
          <span aria-hidden="true">B</span>BookLeaf
          <span className="brand-subtitle">Publishing</span>
        </Link>
        {user && (
          <div className="account">
            <span>{user.displayName}</span>
            <button
              className="secondary"
              onClick={() => signout.mutate()}
              disabled={activeMutations > 0}
            >
              {signout.isPending ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        )}
      </header>
      {user?.role === 'AUTHOR' && (
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/books">My books</NavLink>
          <NavLink to="/tickets" end>
            My questions
          </NavLink>
          <NavLink to="/tickets/new">Ask a question</NavLink>
        </nav>
      )}
      {user?.role === 'ADMIN' && (
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/admin">Support queue</NavLink>
        </nav>
      )}
      <main id="main" ref={main} tabIndex={-1}>
        {signout.error && <ErrorNotice error={signout.error} />}{' '}
        {session.isPending ? (
          <Loading>Checking your session…</Loading>
        ) : !user ? (
          session.error ? (
            <ErrorNotice error={session.error} retry={() => void session.refetch()} />
          ) : (
            <Login />
          )
        ) : user.role === 'ADMIN' ? (
          <>
            <Routes>
              <Route path="/admin" element={<AdminQueue />} />
              <Route path="/admin/tickets/:id" element={<AdminTicket />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </>
        ) : (
          <>
            {session.error && (
              <ErrorNotice error={session.error} retry={() => void session.refetch()} />
            )}
            <Routes>
              <Route path="/" element={<Navigate to="/books" replace />} />
              <Route path="/login" element={<Navigate to="/books" replace />} />
              <Route path="/books" element={<Books />} />
              <Route path="/tickets" element={<Tickets />} />
              <Route path="/tickets/new" element={<TicketForm />} />
              <Route path="/tickets/:id" element={<TicketDetail />} />
              <Route
                path="*"
                element={
                  <section className="empty">
                    <h1>Page not found</h1>
                    <Link to="/books">Return to my books</Link>
                  </section>
                }
              />
            </Routes>
          </>
        )}
      </main>
      <footer>
        <span>BookLeaf Publishing</span>
        <span>Every author deserves to be heard.</span>
      </footer>
    </>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
