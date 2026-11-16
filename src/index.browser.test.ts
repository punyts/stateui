describe('stateui in a real browser', () => {
    it('defines and looks up a custom element', () => {
        // Arrange
        const tag = 'x-stateui-smoke';
        class SmokeElement extends HTMLElement {}

        // Act
        customElements.define(tag, SmokeElement);

        // Assert
        expect(customElements.get(tag)).toBe(SmokeElement);
    });

    it('parses CSS with a constructable stylesheet', () => {
        // Arrange
        const sheet = new CSSStyleSheet();

        // Act
        sheet.replaceSync('a{b:c}');

        // Assert
        expect(sheet.cssRules.length).toBe(1);
    });
});
