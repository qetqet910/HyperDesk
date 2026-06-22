describe("HyperDesk app shell", () => {
  it("launches and shows the topbar title", async () => {
    const title = await $(".hd-topbar__title");
    await title.waitForExist({ timeout: 15000 });
    const text = await title.getText();
    expect(text.length).toBeGreaterThan(0);
  });
});
