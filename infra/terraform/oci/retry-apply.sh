#!/bin/bash
# Retry terraform apply until ARM instances are created successfully
# This script handles the "Out of host capacity" error by retrying

MAX_RETRIES=132  # 11 hours / 5 minutes = 132 attempts
RETRY_DELAY=300  # 5 minutes (300 seconds) between retries

echo "Starting Terraform retry loop..."
echo "Will retry up to $MAX_RETRIES times with $RETRY_DELAY second delay (11 hours total)"
echo

for i in $(seq 1 $MAX_RETRIES); do
    echo "========================================="
    echo "Attempt $i of $MAX_RETRIES"
    echo "Time: $(date)"
    echo "========================================="

    # Run terraform apply
    terraform apply -auto-approve

    # Check exit code
    if [ $? -eq 0 ]; then
        echo
        echo "✅ SUCCESS! Infrastructure created successfully"
        echo
        terraform output
        exit 0
    else
        echo
        echo "❌ Attempt $i failed - Out of capacity"

        if [ $i -lt $MAX_RETRIES ]; then
            echo "⏳ Waiting $RETRY_DELAY seconds before retry..."
            sleep $RETRY_DELAY
        fi
    fi
done

echo
echo "❌ Failed after $MAX_RETRIES attempts"
echo "ARM capacity not available in Stockholm region"
exit 1
