import { STATEUI_VERSION } from './index.js';

describe('stateui', () => {
    it('exports the placeholder version constant', () => {
        // Arrange
        const expected = '0.0.0';

        // Act
        const actual = STATEUI_VERSION;

        // Assert
        expect(actual).toBe(expected);
    });
});
