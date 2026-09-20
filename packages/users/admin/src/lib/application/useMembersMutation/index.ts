import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toApiError, type ApiError } from '@orthacms/utils-admin';
import { membersKeys } from '../../infrastructure/membersKeys';

/**
 * Shared shell for the member mutations. The gateway already normalizes its
 * transport error to {@link ApiError} (so dialogs can branch on
 * `HTTP_STATUS.CONFLICT`); this re-normalizes defensively and, by default,
 * invalidates the whole members cache on success (an added/changed/removed row
 * may land on any page). The one exception is "resend invite", which changes no
 * list-visible field — it opts out with `invalidate: false`. Each hook is then
 * just its gateway call.
 */
export function useMembersMutation<TInput, TResult>(
    mutationFn: (input: TInput) => Promise<TResult>,
    { invalidate = true }: { invalidate?: boolean } = {}
) {
    const queryClient = useQueryClient();

    return useMutation<TResult, ApiError, TInput>({
        mutationFn: (input) =>
            mutationFn(input).catch((error) => {
                throw toApiError(error);
            }),
        onSuccess: invalidate
            ? () => {
                  queryClient.invalidateQueries({ queryKey: membersKeys.all });
              }
            : undefined
    });
}
