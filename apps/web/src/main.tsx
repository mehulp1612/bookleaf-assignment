import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

function FoundationPage() {
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <p className="eyebrow">AUTHOR SUPPORT</p>
      <h1 id="welcome-title">
        A little more clarity.
        <br />A little less waiting.
      </h1>
      <p className="intro">
        A dedicated space for your books, your questions, and the people here to help.
      </p>
      <div className="notice" role="status">
        <span className="notice-dot" aria-hidden="true" />
        <div>
          <strong>Your support portal is taking shape.</strong>
          <p>Author sign-in and support services will be available soon.</p>
        </div>
      </div>
      <div className="features">
        <article>
          <span aria-hidden="true">01</span>
          <h2>Your books</h2>
          <p>Publication details and royalty information, together in one place.</p>
        </article>
        <article>
          <span aria-hidden="true">02</span>
          <h2>Your questions</h2>
          <p>A straightforward way to reach the BookLeaf support team.</p>
        </article>
        <article>
          <span aria-hidden="true">03</span>
          <h2>Clear updates</h2>
          <p>Follow each conversation and know what happens next.</p>
        </article>
      </div>
    </section>
  );
}

function App() {
  return (
    <>
      <header>
        <Link className="brand" to="/" aria-label="BookLeaf home">
          <span aria-hidden="true">B</span>BookLeaf
          <span className="brand-subtitle">Publishing</span>
        </Link>
        <span className="header-label">Author Support</span>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<FoundationPage />} />
          <Route
            path="*"
            element={
              <section className="welcome">
                <h1>Page not found</h1>
                <p>
                  <Link to="/">Return to BookLeaf</Link>
                </p>
              </section>
            }
          />
        </Routes>
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
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
