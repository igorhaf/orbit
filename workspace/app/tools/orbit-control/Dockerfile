FROM docker:29-cli
RUN apk add --no-cache python3 postgresql16-client git
COPY tools/orbit-control/orbit-env.py /usr/local/bin/orbit-env
COPY tools/orbit-control/release_control.py /usr/local/lib/orbit/release_control.py
RUN chmod 755 /usr/local/bin/orbit-env
ENV HOME=/tmp PYTHONDONTWRITEBYTECODE=1
CMD ["python3", "/usr/local/lib/orbit/release_control.py"]
