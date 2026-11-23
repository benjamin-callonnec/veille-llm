/** The user's reply to a question of the tutor (the turn is paused on the server until it comes). */
export interface AskApi {
  answer(item: string, conversation: number, askId: string, text: string): Promise<void>;
}

export const httpAskApi: AskApi = {
  async answer(item, conversation, askId, text) {
    const url = `/api/items/${encodeURIComponent(item)}/conversations/${conversation}/asks/${encodeURIComponent(askId)}/answer`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  },
};
