# Run from docs/promo (also see README for 0.25 s step sheets):  cd docs/promo && bash ../../promo/review.sh
for t in 1920x1080 1080x1920; do
 if [ $t = 1920x1080 ]; then s=480:270; g=6x5; else s=270:480; g=10x3; fi
 ffmpeg -v error -y -i sultan-promo-$t.mp4 -vf "fps=1,scale=$s,drawtext=text='%{eif\:t\:d}s':x=6:y=6:fontsize=20:fontcolor=yellow:box=1:boxcolor=black,tile=$g" -frames:v 1 review/contact-$t.jpg
 ffmpeg -v error -i sultan-promo-$t.mp4 -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=review/luma-$t.txt" -f null -
 awk '/pts_time/{split($3,a,":");t=a[2]} /YAVG/{split($1,b,"=");y=b[2]; if(n&&(y-p>12||p-y>12))printf "jump t=%s %.1f->%.1f\n",t,p,y; if(y>m)m=y; p=y;n++} END{print "frames",n,"maxY",m}' review/luma-$t.txt
done
# 0.25 s step sheets for the transition-heavy ranges
for t in 1920x1080 1080x1920; do
 if [ $t = 1920x1080 ]; then s=480:270; g=6; else s=270:480; g=9; fi
 ffmpeg -v error -y -ss 8.5 -t 1.6 -i sultan-promo-$t.mp4 -vf "fps=4,scale=$s,tile=${g}x1" -frames:v 1 review/step-0.25s-8.5-10s-$t.jpg
 ffmpeg -v error -y -ss 15.5 -t 8.6 -i sultan-promo-$t.mp4 -vf "fps=4,scale=$s,tile=${g}x$(( (35+g-1)/g ))" -frames:v 1 review/step-0.25s-15.5-24s-$t.jpg
done
rm -f review/luma-*.txt
