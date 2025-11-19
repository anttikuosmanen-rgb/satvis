wget https://celestrak.org/NORAD/elements/supplemental/
cat index.html | grep "sup-gp.php?FILE=" | grep "Calendar" |  grep -o 'href="sup-gp[^"]*"' | cut -d'"' -f2 | sed 's|^|https://celestrak.org/NORAD/elements/supplemental/|' > dls.txt
wget -i dls.txt
cat sup-gp.php* > prelaunch.txt
rm index.html* dls.txt sup-gp.php*
