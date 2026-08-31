# example/blackbox-app

A small legacy app that exists only to be *used*, not read.

portamp is never pointed at this directory. `input-explore` is given the URL it
is served on and nothing else, which is the whole point: this is the stand in
for a system whose source is gone.

It carries deliberate defects so `dsp-improve` has something true to find:
an input with no label, a button with no accessible name, a list that renders
nothing when it is empty, a fetch with no error branch, and muted text at a
contrast the original never checked.

    node example/blackbox-app/server.js 87xx
