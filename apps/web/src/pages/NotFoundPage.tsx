import { Link } from 'react-router-dom';
import { EmptyState } from '../components/states';

export function NotFoundPage() {
  return (
    <EmptyState
      className="mt-16"
      title="Page not found"
      description="The page you are looking for does not exist or you do not have access to it."
      action={
        <Link to="/" className="text-sm font-medium text-blue-600 hover:text-blue-700">
          Go to dashboard
        </Link>
      }
    />
  );
}
