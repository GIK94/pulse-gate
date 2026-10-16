import { useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken } from '../lib/api';
import { ME_KEY } from '../lib/auth';
import { Button, Field, Input } from '../components/ui';
import { FormError } from '../components/states';
import { AuthLayout, useMeta } from './AuthLayout';

export function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', organizationName: '' });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const meta = useMeta();

  const register = useMutation({
    mutationFn: () =>
      api.register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        organizationName: form.organizationName.trim() || undefined,
      }),
    onSuccess: async (res) => {
      setCsrfToken(res.csrfToken);
      await qc.refetchQueries({ queryKey: ME_KEY });
      navigate('/', { replace: true });
    },
  });

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const pwTooShort = form.password.length > 0 && form.password.length < 10;

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Set up an organization and start routing traffic"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-blue-600 hover:text-blue-700">
            Sign in
          </Link>
        </>
      }
    >
      {meta.data?.registrationEnabled === false ? (
        <p className="text-sm text-slate-600">
          Registration is disabled on this PulseGate instance. Ask an administrator to add you to an
          organization.
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            register.mutate();
          }}
        >
          <Field label="Name" htmlFor="name">
            <Input
              id="name"
              autoComplete="name"
              required
              maxLength={100}
              value={form.name}
              onChange={set('name')}
              autoFocus
            />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={set('email')}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            hint="10–128 characters"
            error={pwTooShort ? 'Password must be at least 10 characters' : undefined}
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
              value={form.password}
              onChange={set('password')}
            />
          </Field>
          <Field
            label="Organization name"
            htmlFor="org"
            hint="Optional — you can create more later"
          >
            <Input
              id="org"
              maxLength={100}
              value={form.organizationName}
              onChange={set('organizationName')}
            />
          </Field>
          <FormError error={register.error} />
          <Button type="submit" variant="primary" className="w-full" loading={register.isPending}>
            Create account
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
