import { createAdmin } from '@apograph/bootstrap-admin';
import { buildPlugins } from './plugins';
import './styles.css';

createAdmin({ plugins: buildPlugins() });
