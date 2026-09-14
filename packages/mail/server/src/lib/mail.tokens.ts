import { Inject } from '@nestjs/common';

/** DI token for the plugin's resolved configuration. */
export const MAIL_CONFIG = Symbol('MAIL_CONFIG');

/** Injects the resolved mail configuration. */
export const InjectMailConfig = (): ParameterDecorator => Inject(MAIL_CONFIG);
