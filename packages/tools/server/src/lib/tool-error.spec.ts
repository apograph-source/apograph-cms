import {
    BadRequestException,
    ForbiddenException,
    NotFoundException,
    UnprocessableEntityException
} from '@nestjs/common';
import { toToolError } from './tool-error';

describe('toToolError', () => {
    it('maps a 404 to not_found', () => {
        expect(
            toToolError(new NotFoundException('Unknown content type "x".'))
        ).toEqual({
            status: 404,
            code: 'not_found',
            message: 'Unknown content type "x".'
        });
    });

    it('maps a 403 to forbidden', () => {
        expect(toToolError(new ForbiddenException('Nope.'))).toMatchObject({
            status: 403,
            code: 'forbidden'
        });
    });

    // The single most valuable thing a model can be handed back: a 422 naming
    // the offending fields is a failure it can fix on the next call.
    it('carries per-field validation issues through verbatim [tools:I-21]', () => {
        const issues = [{ field: 'title', message: 'is required' }];

        expect(
            toToolError(
                new UnprocessableEntityException({
                    message: 'Validation failed.',
                    issues
                })
            )
        ).toEqual({
            status: 422,
            code: 'validation_failed',
            message: 'Validation failed.',
            issues
        });
    });

    it('joins an array message into one string', () => {
        expect(
            toToolError(
                new BadRequestException({
                    message: ['a must be a string', 'b too']
                })
            ).message
        ).toBe('a must be a string; b too');
    });

    // A raw error could name a table, a column, or a connection string, and a
    // tool result is read by a third-party model.
    it('reports a non-HTTP error as an opaque internal error [tools:I-20]', () => {
        const error = toToolError(
            new Error('connect ECONNREFUSED 10.0.0.5:5432 (db "ortha_prod")')
        );

        expect(error).toEqual({
            status: 500,
            code: 'internal_error',
            message: 'The tool failed unexpectedly. See the server logs.'
        });
        expect(JSON.stringify(error)).not.toContain('ECONNREFUSED');
    });
});
