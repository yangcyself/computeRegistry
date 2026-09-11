import { login } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="auth-shell">
      <form action={login} className="auth-card">
        <p className="eyebrow">Compute Registry</p>
        <h1>Sign in</h1>
        <p className="lede">Use your Supabase Auth email and password.</p>
        {error ? <p className="error-text">{error}</p> : null}
        <label>Email<input name="email" type="email" required autoComplete="email" /></label>
        <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
