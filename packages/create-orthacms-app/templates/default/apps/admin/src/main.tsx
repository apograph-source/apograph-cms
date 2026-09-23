import { createAdmin } from '@orthacms/bootstrap-admin';
import { buildPlugins } from './plugins';
import './styles.css';

createAdmin({ plugins: buildPlugins() });
