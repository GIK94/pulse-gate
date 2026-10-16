import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrfToken } from '../lib/api';
import { ME_KEY } from '../lib/auth';
import { Button, Field, Input } from '../components/ui';
import { FormError } from '../components/states';
import { AuthLayout, useMeta } from './AuthLayout';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const meta = useMeta();
  const from = (location.state as { from?: string } | null)?.from;

  const login = useMutation({
    mutationFn: () => api.login({ email: email.trim(), password }),
    onSuccess: async (res) => {
      setCsrfToken(res.csrfToken);
      await qc.refetchQueries({ queryKey: ME_KEY });
      navigate(from && from.startsWith('/') && !from.startsWith('//') ? from : '/', {
        replace: true,
      });
    },
  });

  const err = login.error;
  const friendlyErr =
    err instanceof ApiError && err.status === 401 ? new Error('Invalid email or password') : err;

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Monitor and control your API traffic"
      footer={
        meta.data?.registrationEnabled !== false && (
          <>
            New to PulseGate?{' '}
            <Link to="/register" className="font-medium text-blue-600 hover:text-blue-700">
              Create an account
            </Link>
          </>
        )
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <FormError error={friendlyErr} />
        <Button type="submit" variant="primary" className="w-full" loading={login.isPending}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
