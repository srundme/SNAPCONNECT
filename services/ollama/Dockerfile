FROM ollama/ollama:0.35.1

ENV NVIDIA_VISIBLE_DEVICES=void

COPY start.sh /usr/local/bin/start-ollama.sh
RUN chmod +x /usr/local/bin/start-ollama.sh

EXPOSE 11434

ENTRYPOINT ["/bin/sh", "/usr/local/bin/start-ollama.sh"]
