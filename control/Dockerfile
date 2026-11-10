FROM docker:29-cli
RUN apk add --no-cache python3 postgresql16-client
COPY bin/orbit-env.py /usr/local/bin/orbit-env
RUN chmod 755 /usr/local/bin/orbit-env
ENV HOME=/tmp
CMD ["sh", "-c", "while :; do sleep 3600; done"]
