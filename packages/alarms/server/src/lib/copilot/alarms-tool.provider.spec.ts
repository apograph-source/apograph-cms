import { PERMISSIONS } from '@orthacms/identity-server';
import { AlarmsCopilotToolProvider } from './alarms-tool.provider';

/**
 * What alarms contributes to the shared tool registry — and, more to the point,
 * what it does not.
 *
 * The server-e2e suite pins the two *behaviours*: the tool is absent from the
 * MCP surface, and a run in another workspace sees nothing. Neither can say
 * anything about the clause that matters most here, which is again an absence:
 * there is **no writing counterpart**. Muting a finding is the act of deciding
 * an exception is acceptable — the one judgement this whole feature exists to
 * ask a human for — and creating a rule is only defensible as a proposal that
 * can carry its live preview. A second tool added to this provider would be
 * offered to every copilot run in every deployment; catching it needs a test
 * that counts, not one that looks up a name it already knows.
 */
describe('AlarmsCopilotToolProvider', () => {
    const provider = new AlarmsCopilotToolProvider({} as never);
    const tools = provider.tools();

    it('offers exactly one tool, and it only reads [alarms:I-34]', () => {
        expect(tools.map((tool) => tool.name)).toEqual([
            'admin_alarms_findings'
        ]);
        expect(tools[0]).toMatchObject({
            readOnly: true,
            effect: 'read',
            requires: [PERMISSIONS.ALARMS_READ]
        });
    });

    it('declares the copilot surface rather than leaving it to be inferred [alarms:I-34]', () => {
        // Omitting `surfaces` means *both* surfaces. `alarms:read` is mintable
        // by no token scope, so on MCP this tool would list and then refuse
        // every call — worse than absent, because it advertises a capability
        // that does not exist.
        expect(tools[0].surfaces).toEqual(['copilot']);
    });

    it('registers itself only where there is a registry to register with', () => {
        const registered: unknown[] = [];
        const registry = {
            register: (p: unknown) => registered.push(p)
        } as never;

        const withRegistry = new AlarmsCopilotToolProvider(
            {} as never,
            registry
        );
        withRegistry.onModuleInit();
        expect(registered).toEqual([withRegistry]);

        // `@Optional()`: a deployment running neither the copilot nor MCP
        // mounts no registry, and this must not fail to boot.
        expect(() =>
            new AlarmsCopilotToolProvider({} as never).onModuleInit()
        ).not.toThrow();
    });
});
